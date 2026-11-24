import {prepareAccountWorkspace,startAccounts,accountLibraryChanged,accountState} from './account-client.mjs';
import {accountBadge,mountAccountProfile} from './account-view.mjs';
import {dismissOnBackdrop} from './modal-dismiss.mjs';
import './site-search.mjs';
import {registerSuggestions} from './search-suggestions.mjs';
import {mountSpellRuleEditor} from './spell-rule-editor.mjs';
import {mountCharacterBuilder} from './character-builder.mjs';
import {syncCharacterTokenRooms} from "./token-room-sync.mjs";
import {setGameTokenImage, syncLocalCharacterToken, showPlay, syncAccountCharacters} from "./play.mjs";
import {archiveName, formatEntries, fullSpell, loadRules, restoreArchive, spellByKey, spellFacts} from "./rules-library.mjs";
import {characterPage, characterProfile, fillSheetResults, initials, sheetPath} from "./character-view.mjs";
import {localTokenBlob, paintCharacterPortraits, saveTokenImage, tokenPortrait} from "./character-token.mjs";
import {openTokenMaker} from "./token-maker.mjs";
import {
  openAttackEditor,
  openItemEditor,
  openVitalsEditor,
  openAbilitiesEditor,
  openDetailsEditor,
  openSkillsEditor,
  openSpellEditor,
  openSlotsEditor
} from "./sheet-subeditors.mjs";
import {enrichCharacter, loadCharacterRules, sheetSkills} from "./character-rules.mjs";
import {readSheetEdits, validateSheetEdits} from "./sheet-editor.mjs";
import {escape, plural, text} from "./format.mjs";
import {readCharacters} from "./characters.mjs";
import {icon} from "./icons.mjs";

const app = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
const notification = document.querySelector("#notification");
const storageKey = "wayfarer-desk-v1";
const navItems = [
  ["overview", "Overview", "home"],
  ["characters", "Character sheets", "users"],
  ["library", "Adventure library", "book"],
  ["spell-rules", "Spell rules", "sparkles"],
  ["play", "Rooms", "dice"],
  ["profile", "Profile", "users"],
];
const featured = [
  {id:"LMoP", image:"lmop-cover.webp", detail:"Follow the trail from Phandalin into the wilds of the Sword Coast."},
  {id:"CoS", image:"cos-cover-art.webp", detail:"Venture into mistbound Barovia and face its vampire lord."},
  {id:"ToA", image:"toa-jungle.webp", detail:"Brave the jungles of Chult in search of the source of a death curse."},
];
const groupNames = {
  supplement:"Supplement", "supplement-alt":"Standalone & short adventures", core:"Core rules", setting:"Campaign setting",
  "setting-alt":"Campaign setting", screen:"DM screen", recipe:"Recipe book", other:"Other",
  "organized-play":"Organized play", homecraft:"Homecraft",
};
const byId = (id) => [...catalog.adventures, ...catalog.books].find((entry) => entry.id === id);

function currentRoute(hash = location.hash) {
  const [requested, characterId, section = "overview"] = hash.slice(1).split("/");
  const page = requested === "game" || navItems.some(([id]) => id === requested) ? requested : "overview";
  const character = page === "characters" && characterId
    ? state.characters.find((entry) => encodeURIComponent(entry.id) === characterId)
    : null;
  return {page, character:character ? enrichCharacter(character) : null, section};
}

prepareAccountWorkspace();
let state;
try {
  const remembered = JSON.parse(localStorage.getItem(storageKey));
  state = {characters: [], active: null, ...remembered};
} catch {
  state = {characters: [], active: null};
}
let catalog = {adventures: [], books: [], version: null};
let catalogStatus = "loading";
let localSamples = [];
let localArchive = "";
let spellRequest = 0;
let gameSheet;
dismissOnBackdrop(dialog,()=>Boolean(gameSheet));
let builderOpen=false;
let catalogKind = "adventures";
let search = "";
let sort = "featured";
let startLevel = "";
let notificationTimer;
let dialogReturnFocus;

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    accountLibraryChanged();
    return true;
  } catch {
    return false;
  }
}

function notice(message) {
  notification.innerHTML = icon("check", 17) + '<span>' + escape(message) + '</span>';
  notification.hidden = false;
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {notification.hidden = true;}, 4600);
}

function levels(entry) {
  const range = entry.level;
  if (!range?.start) return "";
  const bounds = range.end && range.end !== range.start ? range.start + "–" + range.end : range.start;
  if (range.end && range.end !== range.start) return "Levels " + bounds;
  return "Level " + bounds + (range.end ? "" : "+");
}

function button(label, action, lead, variant = "primary", key = "") {
  return '<button type="button" class="button ' + variant + '" data-action="' + action + '"' +
    (key ? ' data-id="' + escape(key) + '"' : "") + '>' + (lead ? icon(lead, 18) : "") + escape(label) + '</button>';
}

function emptyParty() {
  return `<button type="button" class="import-zone" data-action="upload" data-drop="upload">
    <span class="upload-mark">${icon("upload", 23)}</span>
    <strong>Import a character sheet</strong>
    <span>Drop .xlsx files here or click to browse</span>
    <span class="import-types">${icon("sheet", 14)} Excel <i></i> Google Sheets</span>
  </button>`;
}

function partyCards(characters) {
  return '<div class="party-grid">' + characters.map((record, index) => {
    const character = enrichCharacter(record);
    const hp = [character.hp, character.maxHp].every((value) => value == null)
      ? "—" : text(character.hp) + " / " + text(character.maxHp);
    const profile = characterProfile(character);
    return `<a class="character-card" href="${sheetPath(character)}" aria-label="Open character sheet for ${escape(character.name)}">
      <span class="character-open">
        <span class="avatar tone-${index % 4}" aria-hidden="true">${tokenPortrait(initials(character.name),character.tokenImage)}</span>
        <span class="character-info"><strong>${escape(character.name)}</strong>${profile ? '<small>' + profile + '</small>' : ""}</span>
      </span>
      <span class="card-stats">
        <span title="Armor Class">${icon("shield", 15)} <b>${text(character.ac)}</b> AC</span>
        <span title="Hit Points">${icon("heart", 15)} <b>${hp}</b> HP</span>
        ${character.level != null ? '<span class="card-level">Level ' + text(character.level) + '</span>' : ""}
      </span>
    </a>`;
  }).join("") + '</div>';
}

function adventureCard(entry, feature) {
  const image = feature?.image;
  const level = levels(entry);
  const isAdventure = Boolean(entry.maps);
  return `<button class="adventure-card ${image ? "" : "compact-card"}" type="button" data-action="adventure" data-id="${escape(entry.id)}">
    ${image ? `<span class="card-art"><img src="assets/${image}" alt="" width="760" height="506"></span>`
             : `<span class="cover-mark">${icon(isAdventure ? "compass" : "book", 22)}</span>`}
    <span class="adventure-card-body">
      <strong>${escape(entry.name)}</strong>
      ${feature ? `<span class="card-summary">${escape(feature.detail)}</span>` : ""}
      <span class="card-meta">${level ? '<span class="tag">' + escape(level) + '</span>' : ''}
        <span>${escape(image ? (entry.published ?? "").slice(0,4) : (entry.storyline ?? groupNames[entry.group] ?? ""))}</span>
      </span>
    </span>
  </button>`;
}

function activeAdventure() {
  const entry = state.active && byId(state.active);
  if (entry) {
    return `<div class="active-content">
      <div class="active-mark">${icon("flag", 24)}</div>
      <h3>${escape(entry.name)}</h3>
      <p>${[levels(entry), plural(entry.chapters.length, "chapter")].filter(Boolean).map(escape).join(" · ")}</p>
      ${button("View adventure", "adventure", "book", "outline small", entry.id)}
      <a class="text-link" href="#play">Open adventure rooms</a>
    </div>`;
  }
  return `<div class="active-content">
    <div class="active-mark">${icon("compass", 26)}</div>
    <h3>No adventure selected</h3>
    <p>Choose a module for your party from the library.</p>
    <a class="button outline small" href="#library">${icon("book", 17)}Browse adventures</a>
  </div>`;
}

function overview() {
  const picks = featured.map((feature) => [byId(feature.id), feature]).filter(([entry]) => entry);
  return `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-content">
      <h1 id="hero-title">Your next adventure<br>starts here.</h1>
      <p>Gather your party and choose a 5e adventure.</p>
      <a class="button gold" href="#library">${icon("compass", 18)}Explore the library</a>
    </div>
  </section>
  <div class="dashboard-grid">
    <section aria-labelledby="party-heading" class="panel">
      <div class="panel-heading">
        <div><h2 id="party-heading">Your party</h2><p>${state.characters.length ? plural(state.characters.length, "character") : "Add character sheets to assemble your party."}</p></div>
        <div class="panel-heading-actions">
          <button type="button" class="button outline small" data-action="upload">Add characters</button>${state.characters.length ? '<a class="text-link" href="#characters">View all</a>' : ""}
        </div>
      </div>
      ${state.characters.length ? partyCards(state.characters.slice(0, 2)) : emptyParty()}
    </section>
    <section aria-labelledby="active-heading" class="panel active-panel">
      <div class="panel-heading">
        <div><h2 id="active-heading">Active adventure</h2><p>Your party’s current module.</p></div>
        ${icon("flag", 20)}
      </div>
      ${activeAdventure()}
    </section>
  </div>
  <section class="featured" aria-labelledby="featured-heading">
    <div class="section-heading"><div><h2 id="featured-heading">Featured adventures</h2>
      <p>${catalogStatus === "ready" ? "Explore " + catalog.adventures.length + " modules from the 5etools archive." : catalogStatus === "loading" ? "Loading the adventure library…" : "The adventure catalog is unavailable."}</p></div>
      <a class="button outline" href="#library">View all adventures</a>
    </div>
    ${picks.length ? '<div class="featured-grid">' + picks.map(([entry, feature]) => adventureCard(entry, feature)).join("") + '</div>' : ""}
  </section>`;
}

function charactersPage() {
  if(builderOpen)return '<div id="character-builder"></div>';
  return `<header class="page-heading"><div><h1>Character sheets</h1>
    <p>${state.characters.length ? plural(state.characters.length, "character") + " in your party." : "Create a character step by step, or import an existing sheet."}</p></div>
    <div class="character-create-actions">${button("Create character", "build-character", "plus")}${button("Import character", "upload", "upload", "outline")}${localSamples.length ? button("Import supplied sheets", "samples", "sheet", "outline") : ""}</div>
    </header>
    <section class="panel" aria-label="Party character sheets">
    ${state.characters.length ? partyCards(state.characters) : emptyParty()}
    </section>`;
}

function matchingEntries() {
  const term = search.trim().toLowerCase();
  const level = Number(startLevel);
  const results = catalog[catalogKind].filter((entry) => {
    const searchable = [entry.name, entry.id, entry.source, entry.storyline, entry.author].filter(Boolean).join(" ").toLowerCase();
    const matchesLevel = !level || catalogKind !== "adventures" || (
      entry.level?.start <= level && level <= (entry.level.end ?? 20)
    );
    return searchable.includes(term) && matchesLevel;
  });
  if (sort === "title") results.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "newest") results.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
  return results;
}

function libraryPage() {
  return `<header class="page-heading"><div><h1>Adventure library</h1>
    <p>Browse the 5etools archive and choose the next module for your party.</p></div></header>
    <section class="library-section" aria-label="5etools catalog">
      <div class="library-tabs" aria-label="Collection">
        <button type="button" data-action="kind" data-id="adventures" aria-pressed="${catalogKind === "adventures"}">${icon("compass", 18)} Adventures <span>${catalog.adventures.length}</span></button>
        <button type="button" data-action="kind" data-id="books" aria-pressed="${catalogKind === "books"}">${icon("book", 17)} Sourcebooks <span>${catalog.books.length}</span></button>
      </div>
      <div class="library-toolbar">
        <label class="search-field">${icon("search", 19)}<span class="sr-only">Search the catalog</span>
          <input type="search" id="catalog-search" value="${escape(search)}" placeholder="Search by title, source, or series…"></label>
        ${catalogKind === "adventures" ? `<label class="select-field"><span class="sr-only">Filter by party level</span><select id="level-filter">
          <option value="">Any party level</option>${Array.from({length:20}, (_, n) => '<option value="' + (n+1) + '"' + (String(n+1) === startLevel ? " selected" : "") + '>Party level ' + (n+1) + '</option>').join("")}
        </select>${icon("down", 16)}</label>` : ""}
        <label class="select-field"><span class="sr-only">Sort catalog</span><select id="catalog-sort">
          <option value="featured">Archive order</option>
          <option value="title"${sort === "title" ? " selected" : ""}>Title A–Z</option>
          <option value="newest"${sort === "newest" ? " selected" : ""}>Newest first</option>
        </select>${icon("down", 16)}</label>
      </div>
      <div id="catalog-results" aria-busy="${catalogStatus === "loading"}"></div>
    </section>`;
}

function renderResults() {
  const target = document.querySelector("#catalog-results");
  if (!target) return;
  target.setAttribute("aria-busy", String(catalogStatus === "loading"));
  if (catalogStatus !== "ready") {
    target.innerHTML = '<p class="library-status">' + (catalogStatus === "loading" ? "Loading the catalog…" : "The catalog could not be loaded. Refresh the page to try again.") + '</p>';
    return;
  }
  const results = matchingEntries();
  target.innerHTML = '<p class="library-status" role="status">' +
    plural(results.length, catalogKind === "adventures" ? "adventure" : "sourcebook") + '</p>' +
    (results.length ? '<div class="catalog-grid">' + results.map((entry) => adventureCard(entry)).join("") + '</div>' :
      '<div class="results-empty">' + icon("search", 27) + '<h2>No matching titles</h2><p>Try another search or clear the level filter.</p></div>');
}

function render() {
  const {page, character, section} = currentRoute();
  if (page === "game") {
    app.innerHTML = '<main id="main" tabindex="-1" class="game-main"><div id="play-mount"></div></main>';
    showPlay({characters:state.characters, adventures:catalog.adventures, activeAdventure:state.active, localArchive, game:true,
      sessionRoute:location.hash.slice(6)});
    return;
  }
  if (page !== "play") showPlay(null);
  const pageLabel = navItems.find(([id]) => id === page)[1];
  app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#overview">
        <img src="assets/wayfarer.svg" width="43" height="43" alt="">
        <div><strong>Wayfarer</strong><span>5E CAMPAIGN DESK</span></div>
      </a>
      <span class="nav-label">WORKSPACE</span>
      <nav aria-label="Workspace">${navItems.map(([id, label, art]) =>
        '<a class="nav-link' + (id === page ? ' nav-current" aria-current="page"' : '"') + ' href="#' + id + '">' +
        icon(art, 19) + '<span>' + label + '</span></a>').join("")}
      </nav>
      <div class="sidebar-bottom">
        <button class="source-status" type="button" data-action="source">
          <span class="source-icon">${icon("database", 18)}</span>
          <span><strong>5etools archive</strong><small>${catalog.version ? "Version " + escape(catalog.version) : "Data source"}</small></span>
        </button>
      </div>
    </aside>
    <div class="work-area">
      <div class="topbar${character ? " topbar-sheet" : ""}">
        <span class="crumb"><span>Workspace</span> ${icon("chevron", 13)} <strong>${pageLabel}</strong></span>
        ${accountBadge()}${character ? '<a class="button outline" href="#characters">Back to party</a>' :
          page === "play" ? '<a class="button outline" href="#characters">Manage party</a>' : page==='spell-rules'||page==='profile' ? '' : button("Import character", "upload", "plus")}
      </div>
      <main id="main" tabindex="-1" class="content">${character ? characterPage(character, section) : page === "overview" ? overview() : page === "characters" ? charactersPage() : page === "library" ? libraryPage() : page === "profile" ? '<div id="account-profile-mount"></div>' : page === "spell-rules" ? '<div id="spell-rules-mount"></div>' : '<div id="play-mount"></div>'}</main>
    </div>
  </div>`;
  if(page==='profile')mountAccountProfile(document.querySelector('#account-profile-mount'));
  if (page === "library") renderResults();
  if(page==='spell-rules')void mountSpellRuleEditor(document.querySelector('#spell-rules-mount'));
  if(page==='characters' && !character && builderOpen){
    mountCharacterBuilder(document.querySelector('#character-builder'),{close:()=>{builderOpen=false;render();},create:record=>{
      const previous=state.characters;state.characters=[...previous,record];if(!save()){state.characters=previous;return false;}builderOpen=false;location.hash=sheetPath(record);notice('Character created. Use Party → Add in an adventure room.');return true;
    }});
  }
  if (page === "play") showPlay({characters:state.characters, adventures:catalog.adventures,
    activeAdventure:state.active, localArchive});
  if (character) fillSheetResults(character, section);
  paintCharacterPortraits(app);
}

function openDialog(title, subtitle, body, lead = "file", wide = false) {
  if (!dialog.open) dialogReturnFocus = document.activeElement;
  dialog.className = wide ? "dialog-wide" : "";
  dialog.innerHTML = `<header class="dialog-header">
    <span class="dialog-icon">${icon(lead, 23)}</span>
    <div><h2 id="dialog-title">${escape(title)}</h2>${subtitle ? '<p>' + escape(subtitle) + '</p>' : ""}</div>
    <button class="icon-button" type="button" data-action="close" aria-label="Close">${icon("close", 21)}</button>
    </header><div class="dialog-content">${body}</div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector(".icon-button").focus();
}

function importDialog() {
  openDialog("Import character sheets", "Add your characters to the party.", `
    <button type="button" class="import-zone modal-drop" data-action="pick" data-drop="file">
      <span class="upload-mark">${icon("upload", 23)}</span>
      <strong>Choose Excel workbooks</strong>
      <span>Drag and drop one or more .xlsx files here.</span>
    </button>
    <input type="file" id="workbooks" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple hidden>
    ${localSamples.length ? '<div class="sample-actions">' + button("Import " + localSamples.length + " supplied sheets", "samples", "sheet", "outline") + '</div>' : ""}
    <form id="google-form" class="google-form">
      <label for="google-url">${icon("link", 17)} Google Sheets link</label>
      <p id="google-help">Paste a viewable Google Sheets link. For a private sheet, download it as an Excel workbook and upload it above.</p>
      <div class="inline-form"><input id="google-url" type="url" name="url" placeholder="https://docs.google.com/spreadsheets/d/…" aria-describedby="google-help" required>
        <button class="button primary" type="submit">Import sheet</button>
      </div>
    </form><div id="import-message" role="status"></div>`, "upload");
}

function table(headers, rows) {
  return '<div class="table-frame"><table><thead><tr>' +
    headers.map((label) => '<th scope="col">' + escape(label) + '</th>').join("") +
    '</tr></thead><tbody>' + rows.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join("") + '</tr>').join("") +
    '</tbody></table></div>';
}

document.addEventListener("wayfarer:marker", (event) => {
  const marker = event.detail;
  const labels = {treasure:"Treasure",trap:"Trap",hazard:"Hazard",object:"Object",creature:"Creature reference"};
  openDialog(marker.name, labels[marker.type] ?? "Room marker", formatEntries(marker.detail), "map");
});

function showGameSheet(character, section = "overview") {
  gameSheet = {character,section};
  const subtitle = [character.species,character.characterClass,character.level == null ? "" : "Level " + character.level].filter(Boolean).join(" · ");
  openDialog(character.name, subtitle, characterPage(character,section,{embedded:true,tokenEditable:Boolean(character.gameActorId)}), "users", true);
  dialog.classList.add("game-sheet-dialog");
  fillSheetResults(character,section);
  paintCharacterPortraits(dialog);
  if (section !== "overview") dialog.querySelector('.sheet-tab[aria-current]')?.focus({preventScroll:true});
}

document.addEventListener("wayfarer:inspect", (event) => {
  const actor = event.detail;
  const local = state.characters.find((character) => "party:" + character.id === actor.id);
  const imported = actor.sharedSheet ?? (local ? enrichCharacter(local) : null);
  const potions = new Map((actor.potions ?? []).map(({name,quantity}) => [name,quantity]));
  const abilities = imported?.abilities ?? [["STR","Strength"],["DEX","Dexterity"],["CON","Constitution"],
    ["INT","Intelligence"],["WIS","Wisdom"],["CHA","Charisma"]].map(([abbr,label]) => ({abbr,label}));
  showGameSheet({
    sourceName:"Game token", characterClass:"", species:"", skills:[], items:[], spells:actor.spells ?? [], level:actor.level,
    ...imported, id:imported?.id ?? actor.id, name:actor.name, hp:actor.hp, maxHp:actor.maxHp,
    abilities:abilities.map((ability) => ({...ability,modifier:actor.ability?.[ability.abbr.toLowerCase()] ?? ability.modifier,
      save:actor.saves?.[ability.abbr.toLowerCase()] ?? ability.save})),
    ac:actor.ac, speed:String(actor.speed), initiative:actor.initiative, tempHp:actor.tempHp,
    tokenImage:actor.tokenImage, tokenSession:actor.tokenSession, gameActorId:actor.side === "party" ? actor.id : undefined,
    spellDC:actor.spellDC, spellAttack:actor.spellAttack, spellSlots:actor.slots,
    attacks:actor.attacks,resources:actor.resources,classRules:actor.classRules,
    xp:actor.xp ?? imported?.xp,currency:actor.currency ?? imported?.currency,
    items:(actor.items ?? imported?.items ?? []).map((item) => ({...item,quantity:potions.get(item.name) ?? item.quantity})),
  });
});

let changingToken = false;

async function applyCharacterToken(source, character, image) {
  if (changingToken) return;
  const view = dialog.contains(source) ? gameSheet : currentRoute();
  const sheet = source.closest(".character-sheet");
  const report = (target, message) => {
    const output = target?.querySelector(".sheet-token-status");
    if (output) output.textContent = message;
  };
  changingToken = true;
  report(sheet,"Saving token…");
  try {
    if (character.gameActorId) await setGameTokenImage(character.gameActorId,image,character.tokenSession);
    const local = state.characters.find(({id}) => character.gameActorId ? character.gameActorId === "party:"+id : character.id === id);
    let saved = true;
    if (local) {
      if (image) local.tokenImage = image;
      else delete local.tokenImage;
      saved = save();
    }
    const tokenCharacterId=character.gameActorId ?? character.id;
    syncLocalCharacterToken(tokenCharacterId,image);
    const tokenSyncFailures=await syncCharacterTokenRooms(tokenCharacterId,image,{exclude:character.tokenSession});
    const syncNote=tokenSyncFailures.length ? " Some rooms could not be reached. Retry the token update to sync them." : " Token synced to your adventure rooms.";
    const message = !saved ? "Token changed for this visit. Browser storage is unavailable." : (image ? "Token saved." : "Token removed.")+syncNote;
    if (character.gameActorId) {
      document.dispatchEvent(new Event("wayfarer:character-token"));
      if (gameSheet === view && dialog.open) {
        showGameSheet({...character,tokenImage:image},view.section);
        dialog.querySelector('[data-action="pick-token"]')?.focus({preventScroll:true});
        report(dialog,message);
      }
    } else if (currentRoute().character?.id === character.id) {
      render();
      app.querySelector('[data-action="pick-token"]')?.focus({preventScroll:true});
      report(app,message);
    }
  } catch (error) {
    report(sheet,error.message);
  } finally {changingToken = false;}
}

async function changeCharacterToken(source, file) {
  const view = dialog.contains(source) ? gameSheet : currentRoute();
  const character = view?.character;
  if (!character || changingToken) return;
  if (!file) {
    await applyCharacterToken(source, character, undefined);
    return;
  }
  try {
    await openTokenMaker({
      file,
      characterName: character.name,
      onSave: async (savedId) => {
        await applyCharacterToken(source, character, savedId);
      }
    });
  } catch (error) {
    const sheet = source.closest(".character-sheet");
    const output = sheet?.querySelector(".sheet-token-status");
    if (output) output.textContent = error.message;
  }
}

async function spellDialog(key) {
  const record = spellByKey(key);
  if (!record) return;
  openDialog(record.name, record.source + " · " + record.edition + " rules", '<p>Loading spell…</p>', "book", true);
  const request = ++spellRequest;
  let spell;
  try {spell = await fullSpell(record);} catch {spell = record;}
  if (request !== spellRequest || !dialog.open || dialog.querySelector("#dialog-title")?.textContent !== record.name) return;
  const facts = spellFacts(spell);
  const material = typeof spell.components?.m === "string" ? spell.components.m : spell.components?.m?.text;
  const content = spell.entries
    ? formatEntries(spell.entries) + formatEntries(spell.entriesHigherLevel)
    : '<p>Attach your 5etools archive to read this spell’s full entry. <a href="#play" data-action="close">Open archive controls</a></p>';
  openDialog(spell.name, spell.source + " · " + spell.edition + " rules" + (spell.page ? " · p. " + spell.page : ""), `
    <dl class="spell-reference-facts">${facts.map(([label,value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>
    ${material ? '<p class="spell-material"><strong>Materials</strong> ' + escape(material) + '</p>' : ""}
    <div class="spell-reference-text">${content}</div>
    <footer class="dialog-footer"><span>${archiveName() ? escape(archiveName()) : '5etools spell index'}</span>
      ${gameSheet ? '<button type="button" class="button outline small" data-action="game-sheet-back">Back to character</button>' : ""}
      <a class="text-link" href="assets/srd-attribution.txt">SRD attribution</a></footer>`, "book", true);
}

function adventureDialog(entry) {
  if (!entry) return;
  const isAdventure = Boolean(entry.maps);
  const active = state.active === entry.id && isAdventure;
  const feature = featured.find(({id}) => id === entry.id);
  const facts = [levels(entry), entry.storyline, (entry.published ?? "").slice(0,4), entry.author].filter(Boolean);
  const grids = {square:"Square grid", hexColsOdd:"Hex grid", hexColsEven:"Hex grid", hexRowsOdd:"Hex grid", hexRowsEven:"Hex grid"};
  openDialog(entry.name, facts.join(" · "), `
    ${feature ? '<img class="detail-image" src="assets/' + feature.image + '" alt="">' : ""}
    ${feature ? '<p class="module-description">' + escape(feature.detail) + '</p>' : ""}
    <details open><summary>Chapters <small>${entry.chapters.length}</small></summary>
      <ol class="chapter-list">${entry.chapters.map((chapter) => '<li>' + escape(chapter) + '</li>').join("")}</ol>
    </details>
    ${isAdventure ? `<details><summary>Map index <small>${entry.maps.length}</small></summary>
      ${entry.maps.length ? '<p>Map image files are separate from the supplied archive.</p>' + table(["Map", "Chapter", "Grid"], entry.maps.map((map) => [
        text(map.name) + (map.player && !/player/i.test(map.name) ? ' <span class="tag">Player</span>' : ""),
        text(entry.chapters[map.chapter]), text(grids[map.grid]),
      ])) : '<p>This module has no map entries in the archive.</p>'}
    </details>` : ""}
    <footer class="dialog-footer"><span>5etools · ${escape(entry.source ?? entry.id)}</span>
      ${isAdventure ? (active ? '<span class="active-pill">' + icon("check", 17) + ' Active adventure</span>' + button("Clear selection", "clear", "", "outline small", entry.id) :
          button("Set as active adventure", "select", "flag", "primary", entry.id)) : ""}
    </footer>`, isAdventure ? "compass" : "book", true);
}

function sourceDialog() {
  openDialog("5etools archive", catalog.version ? "Version " + catalog.version : "", `
    <div class="source-details">
      <dl class="character-facts">
        <div><dt>Adventure modules</dt><dd>${catalog.adventures.length}</dd></div>
        <div><dt>Sourcebooks</dt><dd>${catalog.books.length}</dd></div>
        <div><dt>Map references</dt><dd>${catalog.adventures.reduce((total, entry) => total + entry.maps.length, 0).toLocaleString()}</dd></div>
      </dl>
      <p>The catalog was built from the supplied 5etools ZIP. It includes chapter titles and a map index. Map images come from the separate 5etools image pack.</p>
      <p>Imported sheets and your active adventure are saved in this browser.</p>
    </div>`, "database");
}

function storeCharacters(characters, name, sourceKey) {
  for (const character of characters) {
    const index = state.characters.findIndex((existing) =>
      ((existing.sourceKey ?? existing.sourceName) === sourceKey && existing.sheetName === character.sheetName) ||
      (existing.name.toLowerCase() === character.name.toLowerCase() &&
        existing.species.toLowerCase() === character.species.toLowerCase()));
    const id = index < 0 ? crypto.randomUUID() : state.characters[index].id;
    const record = {...character, id, sourceName: name, sourceKey,tokenImage:state.characters[index]?.tokenImage,
      rulesEditionOverride:state.characters[index]?.rulesEditionOverride,sheetEdits:state.characters[index]?.sheetEdits};
    if (index < 0) state.characters.push(record);
    else state.characters[index] = record;
  }
}

function decodeWorkbook(blob) {
  const bytes = new Uint8Array(blob);
  if (bytes.length > 20 * 1024 * 1024) throw new Error("The workbook exceeds 20 MB.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("This file is not an Excel workbook.");
  const result = readCharacters(bytes, window.XLSX);
  if (!result.length) throw new Error("No character sheet recognized. Include a Character Name and a class, species, level, or ability score.");
  return result;
}

let importing = false;
async function runImport(entries) {
  if (importing) return;
  const output = dialog.querySelector("#import-message");
  if (!output) return;
  importing = true;
  dialog.querySelectorAll("button:not(.icon-button), input").forEach((el) => {el.disabled = true;});
  output.innerHTML = '<p class="import-progress">Reading character sheets…</p>';
  let count = 0;
  const errors = [];
  try {
    for (const {name, load, sourceKey = name} of entries) {
      try {
        const characters = decodeWorkbook(await load());
        storeCharacters(characters, name, sourceKey);
        count += characters.length;
      } catch (error) {
        errors.push(name + " — " + (error instanceof Error ? error.message : "Import failed."));
      }
    }
    const saved = count ? save() : true;
    if (count) {
      render();
      notice("Imported " + plural(count, "character") + (saved ? "." : ". Browser storage is unavailable."));
    }
    if (output.isConnected && errors.length) {
      output.innerHTML = '<ul class="import-errors">' + errors.map((error) => '<li>' + escape(error) + '</li>').join("") + '</ul>';
    } else if (count && output.isConnected) {
      dialog.close();
      if (!["characters","game","play"].includes(currentRoute().page)) location.hash = "characters";
      else document.querySelector("#main").focus({preventScroll:true});
    }
  } finally {
    importing = false;
    dialog.querySelectorAll("button, input").forEach((el) => {el.disabled = false;});
  }
}

function importFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  if (!dialog.querySelector("#import-message")) importDialog();
  return runImport(files.map((file) => ({
    name:file.name,
    load:async () => {
      if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an .xlsx workbook.");
      if (file.size > 20 * 1024 * 1024) throw new Error("The workbook exceeds 20 MB.");
      return file.arrayBuffer();
    },
  })));
}

function fetchLocalSamples() {
  const entries = localSamples.map(({name, url}) => ({
    name, load:async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not open the supplied workbook.");
      return response.arrayBuffer();
    },
  }));
  if (!dialog.querySelector("#import-message")) importDialog();
  return runImport(entries);
}

function googleExport(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !match) return null;
    return "https://docs.google.com/spreadsheets/d/" + match[1] + "/export?format=xlsx";
  } catch {
    return null;
  }
}

document.addEventListener("submit", (event) => {
  if (event.target.id === "character-edit-form") {
    event.preventDefault();
    const {character} = currentRoute();
    const raw = state.characters.find(({id}) => id === character?.id);
    if (!raw) return;
    try {
      const edits = readSheetEdits(new FormData(event.target),sheetSkills,character);
      validateSheetEdits(enrichCharacter({...raw,sheetEdits:edits}));
      raw.sheetEdits = edits;
      const saved = save();
      render();
      const output = app.querySelector("#character-edit-status");
      output.textContent = saved ? "Character sheet saved." : "Updated for this visit. Browser storage is unavailable.";
      output.tabIndex = -1;
      output.focus({preventScroll:false});
    } catch (error) {
      event.target.querySelector("#character-edit-status").textContent = error.message;
    }
    return;
  }
  if (event.target.id !== "google-form") return;
  event.preventDefault();
  const url = googleExport(new FormData(event.target).get("url"));
  if (!url) {
    document.querySelector("#import-message").innerHTML = '<p class="import-errors">Enter a Google Sheets link from docs.google.com.</p>';
    return;
  }
  runImport([{name:"Google Sheets", sourceKey:url, load:async () => {
    try {
      const response = await fetch(url, {credentials:"omit", signal:AbortSignal.timeout(20000)});
      const type = response.headers.get("Content-Type") ?? "";
      if (!response.ok || type.includes("text/html")) throw new Error();
      if (Number(response.headers.get("Content-Length")) > 20 * 1024 * 1024) throw new Error();
      return response.arrayBuffer();
    } catch {
      throw new Error("Could not read this link. Check its sharing permissions or download it as .xlsx and upload it.");
    }
  }}]);
});

function getActiveCharacterView(targetElement) {
  const isDialog = Boolean(dialog && (dialog.contains(targetElement) || (dialog.open && gameSheet)));
  const view = isDialog ? gameSheet : currentRoute();
  const character = view?.character;
  if (!character) return null;
  const raw = state.characters.find(({id}) => character.gameActorId ? character.gameActorId === "party:"+id : character.id === id);
  return {view, character, raw, isGame: Boolean(isDialog && gameSheet)};
}

function updateActiveCharacter(targetElement, mutator) {
  const active = getActiveCharacterView(targetElement);
  if (!active) return false;
  const {character, raw, isGame} = active;
  if (raw) {
    mutator(raw);
    save();
  } else {
    mutator(character);
  }
  if (isGame && gameSheet) {
    if (raw) {
      const enriched = enrichCharacter(raw);
      gameSheet.character = {...character, ...enriched};
    }
    showGameSheet(gameSheet.character, gameSheet.section);
  } else {
    render();
  }
  return true;
}

document.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const {action, id, index} = control.dataset;
  switch (action) {
    case "edit-attack": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      const idx = Number.parseInt(index ?? id, 10);
      openAttackEditor({
        character: active.character,
        attackIndex: idx,
        onSave: (attackData) => {
          updateActiveCharacter(control, (char) => {
            char.attacks = char.attacks || [];
            char.attacks[idx] = {...char.attacks[idx], ...attackData};
          });
        }
      });
      break;
    }
    case "add-attack": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      openAttackEditor({
        character: active.character,
        attackIndex: -1,
        onSave: (attackData) => {
          updateActiveCharacter(control, (char) => {
            char.attacks = char.attacks || [];
            char.attacks.push(attackData);
          });
        }
      });
      break;
    }
    case "delete-attack": {
      const idx = Number.parseInt(index ?? id, 10);
      updateActiveCharacter(control, (char) => {
        if (char.attacks) char.attacks.splice(idx, 1);
      });
      break;
    }
    case "edit-item": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      const idx = Number.parseInt(index ?? id, 10);
      openItemEditor({
        character: active.character,
        itemIndex: idx,
        onSave: (itemData) => {
          updateActiveCharacter(control, (char) => {
            char.items = char.items || [];
            char.items[idx] = {...char.items[idx], ...itemData};
          });
        }
      });
      break;
    }
    case "add-item": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      openItemEditor({
        character: active.character,
        itemIndex: -1,
        onSave: (itemData) => {
          updateActiveCharacter(control, (char) => {
            char.items = char.items || [];
            char.items.push(itemData);
          });
        }
      });
      break;
    }
    case "delete-item": {
      const idx = Number.parseInt(index ?? id, 10);
      updateActiveCharacter(control, (char) => {
        if (char.items) char.items.splice(idx, 1);
      });
      break;
    }
    case "inc-item-qty": {
      const idx = Number.parseInt(index ?? id, 10);
      updateActiveCharacter(control, (char) => {
        if (char.items?.[idx]) {
          char.items[idx].quantity = (char.items[idx].quantity || 0) + 1;
        }
      });
      break;
    }
    case "dec-item-qty": {
      const idx = Number.parseInt(index ?? id, 10);
      updateActiveCharacter(control, (char) => {
        if (char.items?.[idx]) {
          char.items[idx].quantity = Math.max(0, (char.items[idx].quantity || 1) - 1);
        }
      });
      break;
    }
    case "edit-vitals": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      openVitalsEditor({
        character: active.character,
        onSave: (vitals) => {
          updateActiveCharacter(control, (char) => {
            char.sheetEdits = char.sheetEdits || {};
            if (vitals.hp != null) { char.hp = vitals.hp; char.sheetEdits.hp = vitals.hp; }
            if (vitals.maxHp != null) { char.maxHp = vitals.maxHp; char.sheetEdits.maxHp = vitals.maxHp; }
            if (vitals.tempHp != null) { char.tempHp = vitals.tempHp; char.sheetEdits.tempHp = vitals.tempHp; }
            if (vitals.ac != null) { char.ac = vitals.ac; char.sheetEdits.ac = vitals.ac; }
            if (vitals.initiative != null) { char.initiative = vitals.initiative; char.sheetEdits.initiative = vitals.initiative; }
            if (vitals.speed != null) { char.speed = String(vitals.speed); char.sheetEdits.speed = String(vitals.speed); }
            if (vitals.proficiency != null) { char.proficiency = vitals.proficiency; char.sheetEdits.proficiency = vitals.proficiency; }
            if (vitals.passivePerception != null) { char.passivePerception = vitals.passivePerception; char.sheetEdits.passivePerception = vitals.passivePerception; }
          });
        }
      });
      break;
    }
    case "edit-abilities": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      openAbilitiesEditor({
        character: active.character,
        onSave: (scores) => {
          updateActiveCharacter(control, (char) => {
            char.sheetEdits = char.sheetEdits || {};
            char.sheetEdits.scores = {...(char.sheetEdits.scores || {}), ...scores};
          });
        }
      });
      break;
    }
    case "edit-details": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      openDetailsEditor({
        character: active.character,
        onSave: (details) => {
          updateActiveCharacter(control, (char) => {
            char.sheetEdits = char.sheetEdits || {};
            char.name = details.name;
            char.sheetEdits.name = details.name;
            if (details.characterClass) { char.characterClass = details.characterClass; char.sheetEdits.characterClass = details.characterClass; }
            if (details.species) { char.species = details.species; char.sheetEdits.species = details.species; }
            if (details.level != null) { char.level = details.level; char.sheetEdits.level = details.level; }
            if (details.background) { char.background = details.background; char.sheetEdits.background = details.background; }
            if (details.alignment) { char.alignment = details.alignment; char.sheetEdits.alignment = details.alignment; }
            if (details.player) { char.player = details.player; char.sheetEdits.player = details.player; }
            if (details.xp != null) { char.xp = details.xp; char.sheetEdits.xp = details.xp; }
          });
        }
      });
      break;
    }
    case "edit-skills": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      openSkillsEditor({
        character: active.character,
        skills: sheetSkills,
        onSave: (training) => {
          updateActiveCharacter(control, (char) => {
            char.sheetEdits = char.sheetEdits || {};
            char.sheetEdits.training = {...(char.sheetEdits.training || {}), ...training};
          });
        }
      });
      break;
    }
    case "toggle-prepared": {
      const idx = Number.parseInt(index ?? id, 10);
      updateActiveCharacter(control, (char) => {
        if (char.spells?.[idx]) {
          char.spells[idx].prepared = !char.spells[idx].prepared;
        }
      });
      break;
    }
    case "edit-spell": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      const idx = Number.parseInt(index ?? id, 10);
      openSpellEditor({
        character: active.character,
        spellIndex: idx,
        onSave: (spellData) => {
          updateActiveCharacter(control, (char) => {
            char.spells = char.spells || [];
            char.spells[idx] = {...char.spells[idx], ...spellData};
          });
        }
      });
      break;
    }
    case "add-spell": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      openSpellEditor({
        character: active.character,
        spellIndex: -1,
        onSave: (spellData) => {
          updateActiveCharacter(control, (char) => {
            char.spells = char.spells || [];
            char.spells.push(spellData);
          });
        }
      });
      break;
    }
    case "delete-spell": {
      const idx = Number.parseInt(index ?? id, 10);
      updateActiveCharacter(control, (char) => {
        if (char.spells) char.spells.splice(idx, 1);
      });
      break;
    }
    case "edit-slots": {
      const active = getActiveCharacterView(control);
      if (!active) break;
      openSlotsEditor({
        character: active.character,
        onSave: (slots) => {
          updateActiveCharacter(control, (char) => {
            char.sheetEdits = char.sheetEdits || {};
            char.sheetEdits.slots = {...(char.sheetEdits.slots || {}), ...slots};
            char.spellSlots = {...(char.spellSlots || {}), ...slots};
          });
        }
      });
      break;
    }
    case "build-character": builderOpen=true;if(currentRoute().page!=="characters")location.hash="#characters";else render();break;
    case "upload": importDialog(); break;
    case "pick": document.querySelector("#workbooks").click(); break;
    case "pick-token": if (!changingToken) control.closest(".character-sheet").querySelector("#character-token-file").click(); break;
    case "edit-token": {
      if (changingToken) break;
      const view = dialog.contains(control) ? gameSheet : currentRoute();
      const character = view?.character;
      if (!character?.tokenImage) break;
      try {
        const blob = await localTokenBlob(character.tokenImage);
        await openTokenMaker({
          imageBlob: blob,
          characterName: character.name,
          onSave: async (savedId) => {
            await applyCharacterToken(control, character, savedId);
          }
        });
      } catch (error) {
        const sheet = control.closest(".character-sheet");
        const output = sheet?.querySelector(".sheet-token-status");
        if (output) output.textContent = error.message;
      }
      break;
    }
    case "clear-token": changeCharacterToken(control); break;
    case "samples": if (localSamples.length) fetchLocalSamples(); break;
    case "close": dialog.close(); break;
    case "kind": {
      catalogKind = id;
      render();
      document.querySelector('[data-action="kind"][aria-pressed="true"]').focus();
      break;
    }
    case "source": sourceDialog(); break;
    case "adventure": adventureDialog(byId(id)); break;
    case "spell": spellDialog(id); break;
    case "game-sheet-section": if (gameSheet) showGameSheet(gameSheet.character,id); break;
    case "game-sheet-back": if (gameSheet) showGameSheet(gameSheet.character,gameSheet.section); break;
    case "select": {
      state.active = id;
      const saved = save();
      dialog.close();
      render();
      notice(byId(id).name + " is now active." + (saved ? "" : " Browser storage is unavailable."));
      break;
    }
    case "clear": {
      state.active = null;
      const saved = save();
      dialog.close();
      render();
      notice("Active adventure cleared." + (saved ? "" : " Browser storage is unavailable."));
      break;
    }
    case "confirm-remove": {
      const character = state.characters.find((entry) => entry.id === id);
      if (!character) break;
      openDialog("Remove " + character.name + "?", "You can import this workbook again at any time.", '<div class="dialog-footer">' +
        button("Keep character", "close", "", "outline") + button("Remove character", "remove", "", "danger-fill", id) + '</div>', "users");
      break;
    }
    case "remove": {
      const viewing = currentRoute().character?.id === id;
      state.characters = state.characters.filter((entry) => entry.id !== id);
      const saved = save();
      dialog.close();
      if (viewing) location.hash = "characters";
      else render();
      notice("Character removed." + (saved ? "" : " Browser storage is unavailable."));
      break;
    }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.classList.contains("feature-choice-search")) {
    const query = event.target.value.toLowerCase().trim();
    for (const option of event.target.closest(".feature-choice").querySelectorAll(".feature-choice-option")) {
      option.hidden = !option.dataset.choiceName.includes(query);
    }
    for (const option of event.target.closest(".feature-choice").querySelectorAll("option")) {
      option.hidden = !option.textContent.toLowerCase().includes(query);
    }
    return;
  }
  if (event.target.id === "catalog-search") {
    search = event.target.value;
    renderResults();
  }
  if (event.target.id === "sheet-search") {
    const {character, section} = gameSheet ?? currentRoute();
    if (character) fillSheetResults(character, section);
  }
});

document.addEventListener("change", (event) => {
  switch (event.target.id) {
    case "character-rules-edition": {
      const character = state.characters.find(({id}) => id === currentRoute().character?.id);
      if (!character) break;
      if (event.target.value) character.rulesEditionOverride = event.target.value;
      else delete character.rulesEditionOverride;
      const saved = save();
      render();
      app.querySelector("#character-rules-edition")?.focus({preventScroll:true});
      if (!saved) notice("Rules updated for this visit. Browser storage is unavailable.");
      break;
    }
    case "workbooks": importFiles(event.target.files); event.target.value = ""; break;
    case "character-token-file": {
      const file = event.target.files[0];
      if (file) changeCharacterToken(event.target,file);
      event.target.value = "";
      break;
    }
    case "level-filter": startLevel = event.target.value; renderResults(); break;
    case "catalog-sort": sort = event.target.value; renderResults(); break;
    case "prepared-only": {
      const {character, section} = gameSheet ?? currentRoute();
      if (character) fillSheetResults(character, section);
      break;
    }
  }
});

for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
  document.addEventListener(eventName, (event) => {
    const zone = event.target.closest("[data-drop]");
    if (!zone || (eventName !== "drop" && !event.dataTransfer?.types.includes("Files"))) return;
    event.preventDefault();
    if (eventName === "dragleave" && zone.contains(event.relatedTarget)) return;
    zone.classList.toggle("drag-over", eventName === "dragenter" || eventName === "dragover");
    if (eventName === "drop") importFiles(event.dataTransfer.files);
  });
}
document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#main").focus();
});
dialog.addEventListener("close", () => {
  gameSheet = null;
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus({preventScroll:true});
});
window.addEventListener("hashchange", (event) => {
  const previous = currentRoute(new URL(event.oldURL).hash);
  const next = currentRoute();
  render();
  const sameSheet = next.character && next.character.id === previous.character?.id;
  const focus = sameSheet ? document.querySelector(".sheet-tab[aria-current]") : document.querySelector("#main");
  if (!sameSheet) window.scrollTo({top:0, behavior:"instant"});
  focus?.focus({preventScroll:!sameSheet});
});

render();
const requests = [fetch("catalog.json").then((response) => {
  if (!response.ok) throw new Error("Catalog unavailable");
  return response.json();
}), Promise.allSettled([loadRules(),loadCharacterRules()])];
const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if (local) {
  requests.push(fetch("local-sheets").then((response) => response.ok ? response.json() : []));
  requests.push(fetch("local-archive", {method:"HEAD"}).then((response) => response.ok ? response.headers.get("X-Archive-Name") : ""));
}
restoreArchive();
Promise.allSettled(requests).then(([index, , samples, archive]) => {
  if (index.status === "fulfilled") {
    catalog = index.value;
    catalogStatus = "ready";
  } else {
    catalogStatus = "failed";
  }
  if (samples?.status === "fulfilled" && Array.isArray(samples.value)) localSamples = samples.value;
  if (archive?.status === "fulfilled" && archive.value) localArchive = archive.value;
  // Background catalog loading must not replace an editor the user has already opened.
  if (currentRoute().page === "spell-rules" && document.querySelector(".spell-rule-desk")) return;
  const searchHasFocus = document.activeElement?.id === "catalog-search";
  render();
  if (searchHasFocus) document.querySelector("#catalog-search")?.focus();
});

registerSuggestions('#catalog-search',{options:()=>catalog[catalogKind].filter(entry=>!Number(startLevel)||catalogKind!=='adventures'||entry.level?.start<=Number(startLevel)&&Number(startLevel)<=(entry.level.end??20)).map(entry=>({label:entry.name,search:[entry.id,entry.author,entry.source].filter(Boolean).join(' '),detail:[entry.source??entry.id,entry.level?'Levels '+entry.level.start+'–'+(entry.level.end??20):'',entry.storyline].filter(Boolean).join(' · ')}))});
registerSuggestions('#sheet-search',{options:()=>{const route=gameSheet??currentRoute(),character=route.character;if(!character)return [];const inventory=route.section==='inventory',prepared=document.querySelector('#prepared-only')?.checked;return (inventory?character.items:character.spells).filter(record=>inventory||!prepared||record.prepared).map(record=>({label:record.name.split(' (')[0],search:record.name,detail:inventory?'Inventory · '+(record.quantity??1)+' owned':(record.level?'Level '+record.level:'Cantrip')+(record.source?' · '+record.source:'')}));}});

document.addEventListener('wayfarer:cloud-workspace',event=>{state={characters:[],active:null,...event.detail};if(currentRoute().page==='game'){syncAccountCharacters(state.characters);return;}if(!dialog.open&&!builderOpen&&!document.activeElement?.matches('input,textarea,select'))render();});
document.addEventListener('wayfarer:account-status',()=>{const host=document.querySelector('#account-profile-mount');if(host)mountAccountProfile(host);for(const badge of document.querySelectorAll('.account-badge'))badge.textContent=accountState().user?.displayName??'Sign in';});
void startAccounts();
