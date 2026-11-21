import {escape, plural, signed, text} from "./format.mjs";
import {icon} from "./icons.mjs";

export function sheetPath(character, section = "overview") {
  return "#characters/" + encodeURIComponent(character.id) + (section === "overview" ? "" : "/" + section);
}

export function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("");
}

export function characterProfile(character) {
  return [character.species, character.characterClass].filter(Boolean).map(escape).join(" · ");
}

function sections(character) {
  return [
    ["overview", "Overview"],
    ...(character.attacks.length ? [["actions", "Actions"]] : []),
    ...(character.skills.length || character.abilities.some((ability) => ability.save != null) ? [["skills", "Skills & Saves"]] : []),
    ...(character.items.length ? [["inventory", "Inventory"]] : []),
    ...(character.spells.length ? [["spells", "Spells"]] : []),
  ];
}

function health(character) {
  const {hp, maxHp, tempHp} = character;
  const available = Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0;
  const ratio = available ? Math.max(0, Math.min(1, hp / maxHp)) : null;
  return `<div class="sheet-vital health">
    <div class="vital-label">${icon("heart", 17)} Hit points</div>
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
      <div class="vital-label">${icon(symbol, 17)} ${label}</div>
      <strong>${value}</strong>
    </div>`).join("")}
  </section>`;
}

function abilityScores(character) {
  return `<section class="sheet-box" aria-labelledby="ability-heading">
    <header class="sheet-box-heading"><h2 id="ability-heading">Ability scores</h2></header>
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
  return `<ul class="attack-list">${attacks.map((attack) => {
    const description = describe(attack.name);
    return `<li>
      <h3>${escape(description.name)}</h3>
      ${[attack.bonus, attack.damage].some((value) => value != null && value !== "") ? `<dl>
        ${attack.bonus != null && attack.bonus !== "" ? `<div><dt>Attack</dt><dd>${signed(attack.bonus)}</dd></div>` : ""}
        ${attack.damage ? `<div><dt>Damage</dt><dd>${text(attack.damage)}</dd></div>` : ""}
      </dl>` : ""}
      ${notes(description)}
    </li>`;
  }).join("")}</ul>`;
}

function overview(character) {
  const facts = [
    ["Background", character.background], ["Alignment", character.alignment],
    ["Player", character.player], ["Experience", character.xp == null ? null : character.xp.toLocaleString()],
  ].filter(([, value]) => value != null && value !== "");
  return `${abilityScores(character)}
    <div class="sheet-overview-row">
      ${character.attacks.length ? `<section class="sheet-box" aria-labelledby="quick-actions-heading">
        <header class="sheet-box-heading"><h2 id="quick-actions-heading">Quick actions</h2>
          <a class="text-link" href="${sheetPath(character, "actions")}">All actions</a></header>
        ${attackList(character.attacks.slice(0, 3))}
      </section>` : ""}
      <section class="sheet-box sheet-profile" aria-labelledby="details-heading">
        <header class="sheet-box-heading"><h2 id="details-heading">Character details</h2></header>
        ${facts.length ? `<dl class="profile-facts">${facts.map(([label, value]) =>
          `<div><dt>${label}</dt><dd>${text(value)}</dd></div>`).join("")}</dl>` : ""}
        <div class="sheet-source">
          <span>${icon("sheet", 16)} <span>${escape(character.sourceName || "Imported character")}</span></span>
          <button type="button" class="text-link delete-link" data-action="confirm-remove" data-id="${escape(character.id)}">Remove character</button>
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
    ${character.skills.length ? `<section class="sheet-box" aria-labelledby="skills-heading">
      <header class="sheet-box-heading"><h2 id="skills-heading">Skills</h2></header>
      <dl class="modifier-list skill-list">${character.skills.map(({name, bonus}) =>
        `<div><dt>${escape(name)}</dt><dd>${signed(bonus)}</dd></div>`).join("")}</dl>
    </section>` : ""}
  </div>`;
}

function searchField(label) {
  return `<label class="search-field sheet-search">${icon("search", 18)}<span class="sr-only">${label}</span>
    <input type="search" id="sheet-search" placeholder="${label}…"></label>`;
}

function inventoryContent() {
  return `<section class="sheet-box" aria-labelledby="inventory-heading">
    <header class="sheet-box-heading"><h2 id="inventory-heading">Inventory</h2>${searchField("Search items")}</header>
    <div id="sheet-results"></div>
  </section>`;
}

function spellContent(character) {
  const canFilterPrepared = character.spells.some((spell) => spell.prepared) && character.spells.some((spell) => !spell.prepared);
  return `<section class="sheet-box" aria-labelledby="spells-heading">
    <header class="sheet-box-heading spell-heading">
      <h2 id="spells-heading">Spells</h2>
      <div class="spell-stats">
        ${character.spellDC != null ? `<span>Save DC <strong>${text(character.spellDC)}</strong></span>` : ""}
        ${character.spellAttack != null ? `<span>Spell attack <strong>${signed(character.spellAttack)}</strong></span>` : ""}
      </div>
    </header>
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
    const items = character.items.filter((item) => item.name.toLowerCase().includes(query));
    target.innerHTML = `<p class="sheet-result-count" role="status">${plural(items.length, "item")}</p>` +
      (items.length ? `<table class="inventory-table">
        <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Weight</th></tr></thead>
        <tbody>${items.map((item) => {
          const description = describe(item.name);
          return `<tr><td>${text(description.name)}${notes(description)}</td><td>${text(item.quantity)}</td><td>${text(item.weight)}</td></tr>`;
        }).join("")}</tbody>
      </table>` : '<p class="sheet-empty">No matching items.</p>');
    return;
  }
  const preparedOnly = document.querySelector("#prepared-only")?.checked;
  const spells = character.spells.filter((spell) => (!preparedOnly || spell.prepared) && spell.name.toLowerCase().includes(query));
  const levels = [...new Set(spells.map((spell) => spell.level))].sort((a, b) => a - b);
  target.innerHTML = `<p class="sheet-result-count" role="status">${plural(spells.length, "spell")}</p>` +
    (spells.length ? `<div class="spell-groups">${levels.map((level) => `<section aria-label="${level === 0 ? "Cantrips" : "Level " + level}">
      <h3>${level === 0 ? "Cantrips" : "Level " + level}</h3>
      <ul>${spells.filter((spell) => spell.level === level).map((spell) => {
        const description = describe(spell.name);
        return `<li><div>${text(description.name)}${notes(description)}</div>
          ${spell.prepared ? '<span class="tag">Prepared</span>' : ""}
        </li>`;
      }).join("")}</ul>
    </section>`).join("")}</div>` : '<p class="sheet-empty">No matching spells.</p>');
}

export function characterPage(character, requestedSection) {
  const nav = sections(character);
  const profile = characterProfile(character);
  const section = nav.some(([key]) => key === requestedSection) ? requestedSection : "overview";
  const panels = {
    overview: () => overview(character),
    actions: () => `<section class="sheet-box" aria-labelledby="actions-heading">
      <header class="sheet-box-heading"><h2 id="actions-heading">Actions</h2></header>
      ${attackList(character.attacks)}
      </section>`,
    skills: () => skillContent(character),
    inventory: inventoryContent,
    spells: () => spellContent(character),
  };
  return `<article class="character-sheet">
    <header class="sheet-hero">
      <div class="sheet-avatar" aria-hidden="true">${escape(initials(character.name))}</div>
      <div><h1>${escape(character.name)}</h1>
        ${profile ? `<p>${profile}</p>` : ""}
      </div>
      ${character.level != null ? `<span class="level-badge">Level ${text(character.level)}</span>` : ""}
    </header>
    ${vitals(character)}
    <nav class="sheet-nav" aria-label="Character sheet sections">
      ${nav.map(([key, label]) => `<a class="sheet-tab" href="${sheetPath(character, key)}"
        ${key === section ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>
    <div class="sheet-panel">${panels[section]()}</div>
  </article>`;
}
