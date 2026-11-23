import {escape, plural, signed, text} from "./format.mjs";
import {icon} from "./icons.mjs";
import {tokenPortrait} from "./character-token.mjs";
import {sheetSkills} from "./character-rules.mjs";
import {sheetEditor} from "./sheet-editor.mjs";
import {featureRules} from "./class-feature-view.mjs";
import {matchSpell, ruleKey, spellByKey, spellKey} from "./rules-library.mjs";

export function sheetPath(character, section = "overview") {
  return "#characters/" + encodeURIComponent(character.id) + (section === "overview" ? "" : "/" + section);
}

export function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("");
}

export function characterProfile(character) {
  return [character.species, character.characterClass].filter(Boolean).map(escape).join(" · ");
}

function sections(character, embedded) {
  return [
    ["overview", "Overview"],
    ["actions", "Actions"],
    ["skills", "Skills & Saves"],
    ["inventory", "Inventory"],
    ["spells", "Spells"],
    ...(character.rulesDetails ? [["rules", "Rules"]] : []),
    ...(embedded ? [] : [["edit", "Edit sheet"]]),
  ];
}

function health(character) {
  const {hp, maxHp, tempHp} = character;
  const available = Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0;
  const ratio = available ? Math.max(0, Math.min(1, hp / maxHp)) : null;
  return `<div class="sheet-vital health">
    <div class="vital-label">${icon("heart", 17)} Hit points <button type="button" class="vital-edit-btn" data-action="edit-vitals" aria-label="Edit hit points and combat stats" title="Edit stats">${icon("edit", 13)} Edit</button></div>
    <div class="health-values">
      <div><strong>${text(hp)}</strong>${maxHp != null ? `<span aria-label="Maximum hit points"> / ${text(maxHp)}</span>` : ""}</div>
      ${tempHp > 0 ? `<span class="hp-temp">${text(tempHp)} temp HP</span>` : ""}
    </div>
    ${ratio !== null ? `<meter class="health-meter${ratio <= 0.25 ? " health-low" : ""}" min="0" max="${maxHp}"
      value="${Math.max(0, Math.min(hp, maxHp))}" aria-label="Hit points remaining"></meter>` : ""}
  </div>`;
}

function vitals(character) {
  const speed = /^\d+(\.\d+)?$/.test(character.speed) ? text(character.speed) + " ft" : text(character.speed);
  const stats = [
    ["Armor class", text(character.ac), "shield"],
    ["Initiative", signed(character.initiative), "dice"],
    ["Speed", speed, "footprints"],
    ["Proficiency", signed(character.proficiency), "award"],
    ["Passive perception", text(character.passivePerception), "eye"],
  ];
  return `<section class="sheet-vitals" aria-label="Combat stats">${health(character)}
    ${stats.map(([label, value, symbol]) => `<div class="sheet-vital">
      <div class="vital-label">${icon(symbol, 17)} ${label} <button type="button" class="vital-edit-btn" data-action="edit-vitals" aria-label="Edit ${label}" title="Edit stats">${icon("edit", 12)}</button></div>
      <strong>${value}</strong>
    </div>`).join("")}
  </section>`;
}

function abilityScores(character) {
  return `<section class="sheet-box" aria-labelledby="ability-heading">
    <header class="sheet-box-heading">
      <h2 id="ability-heading">Ability scores</h2>
      <button type="button" class="button small outline" data-action="edit-abilities">${icon("edit", 14)} Edit scores</button>
    </header>
    <dl class="sheet-abilities">${character.abilities.map((ability) => `<div>
      <dt>${escape(ability.label)}</dt>
      <dd><strong aria-label="Modifier ${signed(ability.modifier)}">${signed(ability.modifier)}</strong>
        <span>Score ${text(ability.score)}</span></dd>
    </div>`).join("")}</dl>
  </section>`;
}

function describe(value) {
  // A few supplied workbooks keep long rules excerpts in the name cell.
  for (const match of value.matchAll(/\s(?=\(|[-–—]\s)/g)) {
    const note = value.slice(match.index + 1);
    if (match.index > 100 || note.length < 100) break;
    if (note.startsWith("(") && /^\([^)]{0,70}\)/.test(note)) continue;
    return {name: value.slice(0, match.index), note};
  }
  return {name: value, note: ""};
}

function notes({name, note}) {
  return note ? `<details class="sheet-note"><summary aria-label="Notes for ${escape(name)}">Notes</summary>
    <p>${escape(note)}</p></details>` : "";
}

function attackList(attacks) {
  if (!attacks.length) {
    return `<p class="sheet-empty">No actions or attacks recorded yet. Click "Add action" above.</p>`;
  }
  return `<ul class="attack-list">${attacks.map((attack, index) => {
    const description = describe(attack.name);
    return `<li data-attack-index="${index}">
      <div class="attack-list-item-header">
        <h3>${escape(description.name)}</h3>
        <div class="attack-list-controls">
          <button type="button" class="icon-button-small" data-action="edit-attack" data-index="${index}" aria-label="Edit ${escape(description.name)}" title="Edit action">${icon("edit", 14)}</button>
          <button type="button" class="icon-button-small delete-btn" data-action="delete-attack" data-index="${index}" aria-label="Delete ${escape(description.name)}" title="Delete action">${icon("trash", 14)}</button>
        </div>
      </div>
      ${[attack.bonus, attack.damage].some((value) => value != null && value !== "") ? `<dl>
        ${attack.bonus != null && attack.bonus !== "" ? `<div><dt>Attack</dt><dd>${signed(attack.bonus)}</dd></div>` : ""}
        ${attack.damage ? `<div><dt>Damage</dt><dd>${text(attack.damage)}</dd></div>` : ""}
      </dl>` : ""}
      ${notes(description)}
    </li>`;
  }).join("")}</ul>`;
}

function overview(character, embedded) {
  const facts = [
    ["Background", character.background], ["Alignment", character.alignment],
    ["Player", character.player], ["Experience", character.xp == null ? null : character.xp.toLocaleString()],
  ].filter(([, value]) => value != null && value !== "");
  return `${abilityScores(character)}
    <div class="sheet-overview-row">
      <section class="sheet-box" aria-labelledby="quick-actions-heading">
        <header class="sheet-box-heading">
          <h2 id="quick-actions-heading">Quick actions</h2>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="button small outline" type="button" data-action="add-attack">${icon("plus", 14)} Add action</button>
            ${embedded ? '<button class="text-link sheet-tab" type="button" data-action="game-sheet-section" data-id="actions">All actions</button>' :
               `<a class="text-link" href="${sheetPath(character, "actions")}">All actions</a>`}
          </div>
        </header>
        ${attackList(character.attacks.slice(0, 3))}
      </section>
      <section class="sheet-box sheet-profile" aria-labelledby="details-heading">
        <header class="sheet-box-heading">
          <h2 id="details-heading">Character details</h2>
          <button type="button" class="button small outline" data-action="edit-details">${icon("edit", 14)} Edit details</button>
        </header>
        ${facts.length ? `<dl class="profile-facts">${facts.map(([label, value]) =>
          `<div><dt>${label}</dt><dd>${text(value)}</dd></div>`).join("")}</dl>` : ""}
        <div class="sheet-source">
          <span>${icon("sheet", 16)} <span>${escape(character.sourceName || "Imported character")}</span></span>
          ${embedded ? "" : `<button type="button" class="text-link delete-link" data-action="confirm-remove" data-id="${escape(character.id)}">Remove character</button>`}
        </div>
      </section>
    </div>`;
}

function skillContent(character) {
  const saves = character.abilities.filter((ability) => ability.save != null);
  return `<div class="sheet-skill-row">
    ${saves.length ? `<section class="sheet-box" aria-labelledby="saving-throws-heading">
      <header class="sheet-box-heading"><h2 id="saving-throws-heading">Saving throws</h2></header>
      <dl class="modifier-list">${saves.map(({label, save}) =>
        `<div><dt>${escape(label)}</dt><dd>${signed(save)}</dd></div>`).join("")}</dl>
    </section>` : ""}
    <section class="sheet-box" aria-labelledby="skills-heading">
      <header class="sheet-box-heading">
        <h2 id="skills-heading">Skills</h2>
        <button type="button" class="button small outline" data-action="edit-skills">${icon("edit", 14)} Edit training</button>
      </header>
      ${character.skills.length ? `<dl class="modifier-list skill-list">${character.skills.map(({name, bonus, base}) =>
        `<div><dt>${escape(name)}</dt><dd>${bonus == null && base != null ? `<span class="sheet-base-value">Base ${signed(base)}</span>` : signed(bonus)}</dd></div>`).join("")}</dl>` : '<p class="sheet-empty">No skill training recorded.</p>'}
    </section>
  </div>`;
}

function rulesContent(character, embedded) {
  const rules = character.rulesDetails;
  const joined = (entries) => Array.isArray(entries) ? entries.join(", ") : "";
  const hitDice = Object.entries(rules.hitDice ?? {}).map(([die, count]) => `${count}d${die}`).join(" + ");
  const facts = [
    ["Size", rules.size], ["Darkvision", rules.darkvision ? `${rules.darkvision} ft` : ""],
    ["Other movement", joined(rules.extraSpeeds)], ["Total Hit Dice", hitDice],
    ["Base AC before gear and features", rules.baseAC], ["Base Passive Perception before training", rules.basePerception],
    ["Damage resistances", joined(rules.resistances)], ["Trained skills", joined(rules.skillTraining)],
    ["Languages", joined(rules.languages)], ["Tools", joined(rules.tools)],
    ["Armor training", joined(rules.armor)], ["Weapon training", joined(rules.weapons)], ["Feats", joined(rules.feats)],
  ].filter(([,value]) => value != null && value !== "");
  const features = Array.isArray(rules.features) ? rules.features : [];
  const choices = Array.isArray(rules.choices) ? rules.choices : [];
  const speciesSpells = Array.isArray(rules.speciesSpells) ? rules.speciesSpells.filter(Array.isArray) : [];
  return `<section class="sheet-box sheet-rules" aria-labelledby="sheet-rules-heading">
    <header class="sheet-box-heading"><h2 id="sheet-rules-heading">Character rules</h2>
      ${embedded ? `<span class="tag">${escape(rules.edition)} 5e</span>` : `<label class="sheet-edition">Rules edition
        <select id="character-rules-edition">
          <option value="">Auto (${escape(rules.edition)})</option>
          ${["2014","2024"].map((year) => `<option value="${year}"${character.rulesEditionOverride === year ? " selected" : ""}>${year}</option>`).join("")}
        </select>
      </label>`}
    </header>
    ${rules.derived?.length ? `<p class="sheet-rules-note"><strong>Filled from the rules</strong> ${escape(joined(rules.derived))}.</p>` : ""}
    <p class="sheet-rules-note">Blank choices and rolls can still be filled in on your workbook. Base values are shown where equipment or training could change the total.</p>
    ${facts.length ? `<dl class="profile-facts">${facts.map(([label,value]) => `<div><dt>${label}</dt><dd>${text(value)}</dd></div>`).join("")}</dl>` : ""}
    ${features.length ? `<div class="sheet-rule-groups">${features.map(({name,entries}) =>
      `<div><h3>${escape(name)}</h3><p>${escape(joined(entries))}</p></div>`).join("")}</div>` : ""}
    ${speciesSpells.length ? `<div class="sheet-rule-groups"><div><h3>Spells granted by species</h3><ul>${speciesSpells.map(([level,name,source,usage]) => {
      const spell = source ? spellByKey(String(source).toLowerCase()+"|"+ruleKey(name)) : matchSpell(name);
      const label = spell ? `<button type="button" class="spell-link" data-action="spell" data-id="${escape(spellKey(spell))}">${escape(spell.name)}</button>` : text(name);
      return `<li>${label} · From level ${text(level)}${usage ? " · " + escape(usage) : ""}</li>`;
    }).join("")}</ul></div></div>` : ""}
    ${choices.length ? `<div class="sheet-rule-groups"><div><h3>Options in the rules</h3><ul>${choices.map((choice) => `<li>${escape(choice)}</li>`).join("")}</ul></div></div>` : ""}
    ${rules.sources?.length ? `<p class="sheet-rules-note"><strong>Sources</strong> ${escape(joined(rules.sources))}.</p>` : ""}
  </section>${featureRules(character)}`;
}

function searchField(label) {
  return `<label class="search-field sheet-search">${icon("search", 18)}<span class="sr-only">${label}</span>
    <input type="search" id="sheet-search" placeholder="${label}…"></label>`;
}

function inventoryContent() {
  return `<section class="sheet-box" aria-labelledby="inventory-heading">
    <header class="sheet-box-heading">
      <h2 id="inventory-heading">Inventory</h2>
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="button small outline" type="button" data-action="add-item">${icon("plus", 14)} Add item</button>
        ${searchField("Search items")}
      </div>
    </header>
    <div id="sheet-results"></div>
  </section>`;
}

function spellContent(character) {
  const canFilterPrepared = character.spells.some((spell) => spell.prepared) && character.spells.some((spell) => !spell.prepared);
  return `<section class="sheet-box" aria-labelledby="spells-heading">
    <header class="sheet-box-heading spell-heading">
      <h2 id="spells-heading">Spells</h2>
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="button small outline" type="button" data-action="add-spell">${icon("plus", 14)} Add spell</button>
        <div class="spell-stats">
          ${character.spellDC != null ? `<span>Save DC <strong>${text(character.spellDC)}</strong></span>` : ""}
          ${character.spellAttack != null ? `<span>Spell attack <strong>${signed(character.spellAttack)}</strong></span>` : ""}
        </div>
      </div>
    </header>
    <div class="sheet-slots-wrapper" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding:8px 17px; border-bottom:1px solid var(--sheet-border);">
      ${Object.keys(character.spellSlots ?? {}).length ? `<dl class="sheet-slot-summary" style="margin:0;">${Object.entries(character.spellSlots).map(([level,{current,maximum}]) =>
        `<div><dt>Level ${text(level)} slots</dt><dd>${text(current)} / ${text(maximum)}</dd></div>`).join("")}</dl>` : `<span style="color:var(--muted); font-size:.86rem;">No spell slots recorded</span>`}
      <button class="button small outline" type="button" data-action="edit-slots">${icon("edit", 14)} Edit slots</button>
    </div>
    ${character.resources?.pactMagic ? `<dl class="sheet-slot-summary"><div><dt>Pact Magic · level ${character.resources.pactMagic.slotLevel}</dt>
      <dd>${character.resources.pactMagic.current} / ${character.resources.pactMagic.maximum}</dd><small>Short or long rest</small></div></dl>` : ""}
    <div class="sheet-filters">${searchField("Search spells")}
      ${canFilterPrepared ? `<label class="prepared-filter"><input id="prepared-only" type="checkbox"> Prepared only</label>` : ""}
    </div>
    <div id="sheet-results"></div>
  </section>`;
}

export function fillSheetResults(character, section) {
  const target = document.querySelector("#sheet-results");
  const query = document.querySelector("#sheet-search")?.value.trim().toLowerCase() ?? "";
  if (!target) return;
  if (section === "inventory") {
    const items = character.items.map((item, index) => ({...item, originalIndex: index}))
      .filter((item) => item.name.toLowerCase().includes(query));
    target.innerHTML = `<p class="sheet-result-count" role="status">${plural(items.length, "item")}</p>` +
      (items.length ? `<table class="inventory-table">
        <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Weight</th><th scope="col" style="width:75px; text-align:center;">Actions</th></tr></thead>
        <tbody>${items.map((item) => {
          const description = describe(item.name);
          return `<tr>
            <td>${text(description.name)}${notes(description)}</td>
            <td>
              <span class="qty-control">
                <button type="button" class="qty-btn" data-action="dec-item-qty" data-index="${item.originalIndex}" aria-label="Decrease quantity">−</button>
                <strong>${text(item.quantity ?? 1)}</strong>
                <button type="button" class="qty-btn" data-action="inc-item-qty" data-index="${item.originalIndex}" aria-label="Increase quantity">+</button>
              </span>
            </td>
            <td>${text(item.weight)}</td>
            <td style="text-align:center;">
              <span class="inventory-actions">
                <button type="button" class="icon-button-small" data-action="edit-item" data-index="${item.originalIndex}" aria-label="Edit ${escape(description.name)}" title="Edit item">${icon("edit", 14)}</button>
                <button type="button" class="icon-button-small delete-btn" data-action="delete-item" data-index="${item.originalIndex}" aria-label="Delete ${escape(description.name)}" title="Delete item">${icon("trash", 14)}</button>
              </span>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table>` : '<p class="sheet-empty">No matching items. Click "Add item" to add gear.</p>');
    return;
  }
  const preparedOnly = document.querySelector("#prepared-only")?.checked;
  const spellsWithIndex = character.spells.map((spell, index) => ({...spell, originalIndex: index}));
  const spells = spellsWithIndex.filter((spell) => (!preparedOnly || spell.prepared) && spell.name.toLowerCase().includes(query));
  const levels = [...new Set(spells.map((spell) => spell.level))].sort((a, b) => a - b);
  target.innerHTML = `<p class="sheet-result-count" role="status">${plural(spells.length, "spell")}</p>` +
    (spells.length ? `<div class="spell-groups">${levels.map((level) => `<section aria-label="${level === 0 ? "Cantrips" : "Level " + level}">
      <h3>${level === 0 ? "Cantrips" : "Level " + level}</h3>
      <ul>${spells.filter((spell) => spell.level === level).map((spell) => {
        const description = describe(spell.name);
        const reference = matchSpell(spell.name);
        const spellName = reference ? `<button type="button" class="spell-link" data-action="spell" data-id="${escape(spellKey(reference))}"
            aria-label="View 5e spell ${escape(reference.name)}">${text(description.name)}</button>` : text(description.name);
        return `<li><div>${spellName}${reference ? `<small class="spell-source">${escape(reference.source)}${spell.level !== reference.level ? " · Reference level " + reference.level : ""}</small>` : ""}
          ${notes(description)}</div>
          <div class="spell-row-actions">
            <button type="button" class="tag ${spell.prepared ? 'tag-prepared' : 'tag-unprepared'}" data-action="toggle-prepared" data-index="${spell.originalIndex}" aria-label="Toggle prepared status for ${escape(description.name)}">${spell.prepared ? "Prepared" : "Unprepared"}</button>
            <button type="button" class="icon-button-small" data-action="edit-spell" data-index="${spell.originalIndex}" aria-label="Edit ${escape(description.name)}" title="Edit spell">${icon("edit", 13)}</button>
            <button type="button" class="icon-button-small delete-btn" data-action="delete-spell" data-index="${spell.originalIndex}" aria-label="Delete ${escape(description.name)}" title="Delete spell">${icon("trash", 13)}</button>
          </div>
        </li>`;
      }).join("")}</ul>
    </section>`).join("")}</div>` : '<p class="sheet-empty">No matching spells. Click "Add spell" to add one.</p>');
}

export function characterPage(character, requestedSection, {embedded = false, tokenEditable = !embedded} = {}) {
  const nav = sections(character,embedded);
  const profile = characterProfile(character);
  const section = nav.some(([key]) => key === requestedSection) ? requestedSection : "overview";
  const panels = {
    overview: () => overview(character,embedded),
    actions: () => `<section class="sheet-box" aria-labelledby="actions-heading">
      <header class="sheet-box-heading">
        <h2 id="actions-heading">Actions</h2>
        <button class="button small outline" type="button" data-action="add-attack">${icon("plus", 14)} Add action</button>
      </header>
      ${attackList(character.attacks)}
      </section>${featureRules(character)}`,
    skills: () => skillContent(character),
    inventory: inventoryContent,
    spells: () => spellContent(character),
    rules: () => rulesContent(character,embedded),
    edit: () => sheetEditor(character,sheetSkills),
  };
  const portrait = `<div class="sheet-avatar" aria-hidden="true">${tokenPortrait(initials(character.name),character.tokenImage,character.tokenSession)}</div>`;
  const tokenControls = tokenEditable ? `<div class="sheet-token-controls">
    <button type="button" class="game-button" data-action="pick-token">${character.tokenImage ? "Replace token" : "Upload token"}</button>
    ${character.tokenImage ? '<button type="button" class="game-button" data-action="edit-token">Edit token</button>' : ""}
    ${character.tokenImage ? '<button type="button" class="game-button" data-action="clear-token">Remove token</button>' : ""}
    <input id="character-token-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Character token image" hidden>
    <p class="sheet-token-status" role="status"></p>
  </div>` : "";
  return `<article class="character-sheet">
    ${embedded ? tokenEditable ? `<div class="sheet-token-bar">${portrait}${tokenControls}</div>` : "" : `<header class="sheet-hero">
      ${portrait}
      <div><h1>${escape(character.name)}</h1>
        ${profile ? `<p>${profile}</p>` : ""}
        ${tokenControls}
      </div>
      ${character.level != null ? `<span class="level-badge">Level ${text(character.level)}</span>` : ""}
    </header>`}
    ${vitals(character)}
    <nav class="sheet-nav" aria-label="Character sheet sections">
      ${nav.map(([key,label]) => {
        const current = key === section ? ' aria-current="page"' : "";
        return embedded
          ? `<button class="sheet-tab" type="button" data-action="game-sheet-section" data-id="${key}"${current}>${label}</button>`
          : `<a class="sheet-tab" href="${sheetPath(character,key)}"${current}>${label}</a>`;
      }).join("")}
    </nav>
    <div class="sheet-panel">${panels[section]()}</div>
  </article>`;
}
