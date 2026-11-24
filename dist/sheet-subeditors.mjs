import {dismissOnBackdrop} from './modal-dismiss.mjs';
import {initSheetSuggestions} from './sheet-suggestions.mjs';
import {escape, signed, text} from "./format.mjs";
import {icon} from "./icons.mjs";

const abilitiesList = [
  ["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"],
  ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"]
];

function getSubeditorDialog() {
  let dialog = document.getElementById("sheet-subeditor-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "sheet-subeditor-dialog";
    dialog.className = "sheet-subeditor-dialog";
    dialog.setAttribute("aria-labelledby", "sheet-subeditor-title");
    document.body.appendChild(dialog);
    dismissOnBackdrop(dialog);
  }
  return dialog;
}

export function openSubeditor({title, subtitle = "", iconName = "edit", formHtml, onSave}) {
  const dialog = getSubeditorDialog();
  dialog.innerHTML = `
    <header class="dialog-header">
      <span class="dialog-icon">${icon(iconName, 22)}</span>
      <div>
        <h2 id="sheet-subeditor-title">${escape(title)}</h2>
        ${subtitle ? `<p>${escape(subtitle)}</p>` : ""}
      </div>
      <button class="icon-button" type="button" data-action="close-subeditor" aria-label="Close">${icon("close", 20)}</button>
    </header>
    <form id="sheet-subeditor-form" class="subeditor-form">
      ${formHtml}
      <div class="subeditor-footer">
        <button type="button" class="button outline" data-action="close-subeditor">Cancel</button>
        <button type="submit" class="button primary">Save</button>
      </div>
    </form>
  `;

  const closeBtn = dialog.querySelector('[data-action="close-subeditor"]');
  const cancelBtn = dialog.querySelector('.subeditor-footer button[data-action="close-subeditor"]');
  const close = () => {
    dialog.close();
  };
  closeBtn?.addEventListener("click", close, {once: true});
  cancelBtn?.addEventListener("click", close, {once: true});

  const form = dialog.querySelector("#sheet-subeditor-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const data = new FormData(form);
      const res = onSave(data);
      if (res !== false) {
        dialog.close();
      }
    } catch (err) {
      let errBox = form.querySelector(".subeditor-error");
      if (!errBox) {
        errBox = document.createElement("p");
        errBox.className = "subeditor-error";
        form.prepend(errBox);
      }
      errBox.textContent = err.message || "An error occurred.";
    }
  });

  initSheetSuggestions(dialog);
  if (!dialog.open) {
    dialog.showModal();
  }
  const firstInput = form.querySelector("input:not([type=hidden]), select, textarea");
  firstInput?.focus();
}

export function openAttackEditor({character, attackIndex = -1, onSave}) {
  const isEdit = attackIndex >= 0 && character.attacks?.[attackIndex];
  const attack = isEdit ? character.attacks[attackIndex] : {name: "", bonus: "", damage: "", note: ""};

  // If attack has embedded note in name:
  let rawName = attack.name || "";
  let rawNote = attack.note || "";
  if (!rawNote) {
    for (const match of rawName.matchAll(/\s(?=\(|[-–—]\s)/g)) {
      const note = rawName.slice(match.index + 1);
      if (match.index <= 100 && (note.length >= 100 || (note.startsWith("(") && /^\([^)]{0,70}\)/.test(note)))) {
        rawName = rawName.slice(0, match.index);
        rawNote = note.replace(/^\(|\)$/g, "");
        break;
      }
    }
  }

  const bonusValue = attack.bonus != null && attack.bonus !== "" ? (typeof attack.bonus === "number" ? signed(attack.bonus) : attack.bonus) : "";

  const formHtml = `
    <label>
      Action / Weapon name
      <input type="text" name="name" data-suggest="weapons" value="${escape(rawName)}" placeholder="e.g. Longsword, Fire Bolt, Dagger" required maxlength="120">
    </label>
    <div class="subeditor-grid">
      <label>
        Attack bonus
        <input type="text" name="bonus" value="${escape(bonusValue)}" placeholder="+5, +7, or 0">
      </label>
      <label>
        Damage formula &amp; type
        <input type="text" name="damage" value="${escape(attack.damage || "")}" placeholder="e.g. 1d8+3 slashing, 1d10 fire">
      </label>
    </div>
    <label>
      Notes / Properties
      <textarea name="note" placeholder="Versatile (1d10), Range 20/60 ft, Light, Finesse…">${escape(rawNote)}</textarea>
    </label>
  `;

  openSubeditor({
    title: isEdit ? "Edit action / attack" : "Add action / attack",
    subtitle: isEdit ? `Modify details for ${rawName}` : `Add a weapon or attack to ${character.name}`,
    iconName: "sword",
    formHtml,
    onSave: (data) => {
      const name = data.get("name")?.trim();
      if (!name) throw new Error("Action name is required.");
      const bonusStr = data.get("bonus")?.trim() || "";
      let bonus = bonusStr;
      if (/^[+-]?\d+$/.test(bonusStr)) {
        bonus = Number.parseInt(bonusStr, 10);
      } else if (!bonusStr) {
        bonus = null;
      }
      const damage = data.get("damage")?.trim() || "";
      const note = data.get("note")?.trim() || "";
      const formattedName = note ? `${name} (${note})` : name;
      return onSave({
        name: formattedName,
        bonus,
        damage,
        note
      });
    }
  });
}

export function openItemEditor({character, itemIndex = -1, onSave}) {
  const isEdit = itemIndex >= 0 && character.items?.[itemIndex];
  const item = isEdit ? character.items[itemIndex] : {name: "", quantity: 1, weight: 0, note: ""};

  let rawName = item.name || "";
  let rawNote = item.note || "";
  if (!rawNote) {
    for (const match of rawName.matchAll(/\s(?=\(|[-–—]\s)/g)) {
      const note = rawName.slice(match.index + 1);
      if (match.index <= 100 && (note.length >= 100 || (note.startsWith("(") && /^\([^)]{0,70}\)/.test(note)))) {
        rawName = rawName.slice(0, match.index);
        rawNote = note.replace(/^\(|\)$/g, "");
        break;
      }
    }
  }

  const formHtml = `
    <label>
      Item name
      <input type="text" name="name" data-suggest="equipment" value="${escape(rawName)}" placeholder="e.g. Potion of Healing, Rope (50 ft)" required maxlength="140">
    </label>
    <div class="subeditor-grid">
      <label>
        Quantity
        <input type="number" name="quantity" value="${item.quantity != null ? item.quantity : 1}" min="0" max="99999" step="1">
      </label>
      <label>
        Weight (lbs)
        <input type="number" name="weight" value="${item.weight != null ? item.weight : ""}" min="0" max="99999" step="0.1" placeholder="0">
      </label>
    </div>
    <label>
      Notes &amp; Details
      <textarea name="note" placeholder="Description, charges, magical properties…">${escape(rawNote)}</textarea>
    </label>
  `;

  openSubeditor({
    title: isEdit ? "Edit inventory item" : "Add inventory item",
    subtitle: isEdit ? `Modify details for ${rawName}` : `Add gear or treasure to ${character.name}`,
    iconName: "sheet",
    formHtml,
    onSave: (data) => {
      const name = data.get("name")?.trim();
      if (!name) throw new Error("Item name is required.");
      const qtyStr = data.get("quantity")?.trim();
      const quantity = qtyStr ? Number.parseInt(qtyStr, 10) : 1;
      const weightStr = data.get("weight")?.trim();
      const weight = weightStr ? Number.parseFloat(weightStr) : null;
      const note = data.get("note")?.trim() || "";
      const formattedName = note ? `${name} (${note})` : name;
      return onSave({
        name: formattedName,
        quantity,
        weight,
        note
      });
    }
  });
}

export function openVitalsEditor({character, onSave}) {
  const walking = Number.parseInt(character.speed, 10);
  const speedVal = Number.isFinite(walking) ? walking : character.speed || "";

  const formHtml = `
    <div class="subeditor-grid">
      <label>
        Current Hit Points
        <input type="number" name="hp" value="${character.hp != null ? character.hp : ""}" min="0" max="2000" placeholder="0">
      </label>
      <label>
        Maximum Hit Points
        <input type="number" name="maxHp" value="${character.maxHp != null ? character.maxHp : ""}" min="1" max="2000" placeholder="10">
      </label>
      <label>
        Temporary Hit Points
        <input type="number" name="tempHp" value="${character.tempHp != null ? character.tempHp : 0}" min="0" max="2000" placeholder="0">
      </label>
      <label>
        Armor Class (AC)
        <input type="number" name="ac" value="${character.ac != null ? character.ac : ""}" min="0" max="60" placeholder="10">
      </label>
      <label>
        Initiative bonus
        <input type="number" name="initiative" value="${character.initiative != null ? character.initiative : ""}" min="-50" max="50" placeholder="0">
      </label>
      <label>
        Speed (ft)
        <input type="text" name="speed" value="${escape(speedVal)}" placeholder="30">
      </label>
      <label>
        Proficiency Bonus
        <input type="number" name="proficiency" value="${character.proficiency != null ? character.proficiency : ""}" min="0" max="20" placeholder="2">
      </label>
      <label>
        Passive Perception
        <input type="number" name="passivePerception" value="${character.passivePerception != null ? character.passivePerception : ""}" min="0" max="100" placeholder="10">
      </label>
    </div>
  `;

  openSubeditor({
    title: "Edit combat stats & vitals",
    subtitle: `Update hit points and stats for ${character.name}`,
    iconName: "heart",
    formHtml,
    onSave: (data) => {
      const readNum = (key) => {
        const str = data.get(key)?.trim();
        return str ? Number.parseInt(str, 10) : null;
      };
      const hp = readNum("hp");
      const maxHp = readNum("maxHp");
      const tempHp = readNum("tempHp") ?? 0;
      const ac = readNum("ac");
      const initiative = readNum("initiative");
      const speed = data.get("speed")?.trim() || "30";
      const proficiency = readNum("proficiency");
      const passivePerception = readNum("passivePerception");

      if (hp != null && maxHp != null && hp > maxHp) {
        throw new Error("Current HP cannot exceed maximum HP.");
      }

      return onSave({
        hp, maxHp, tempHp, ac, initiative, speed, proficiency, passivePerception
      });
    }
  });
}

export function openAbilitiesEditor({character, onSave}) {
  const currentScores = {};
  for (const {abbr, score} of character.abilities || []) {
    currentScores[abbr.toLowerCase()] = score ?? 10;
  }

  const formHtml = `
    <div class="subeditor-grid" style="grid-template-columns: repeat(2, 1fr);">
      ${abilitiesList.map(([key, label]) => {
        const score = currentScores[key] ?? 10;
        const mod = Math.floor((score - 10) / 2);
        return `
          <label class="ability-score-label">
            <span>${escape(label)} (${key.toUpperCase()})</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <input type="number" name="score-${key}" value="${score}" min="1" max="30" step="1" required data-ability="${key}">
              <span class="tag mod-badge" id="mod-${key}">${signed(mod)}</span>
            </div>
          </label>
        `;
      }).join("")}
    </div>
  `;

  openSubeditor({
    title: "Edit ability scores",
    subtitle: `Adjust base scores for ${character.name}`,
    iconName: "award",
    formHtml,
    onSave: (data) => {
      const scores = {};
      for (const [key] of abilitiesList) {
        const val = data.get("score-" + key)?.trim();
        const num = val ? Number.parseInt(val, 10) : 10;
        if (num < 1 || num > 30) throw new Error("Ability scores must be between 1 and 30.");
        scores[key] = num;
      }
      return onSave(scores);
    }
  });

  // Attach live modifier updates on input
  const dialog = document.getElementById("sheet-subeditor-dialog");
  dialog.querySelectorAll("input[data-ability]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.ability;
      const num = Number.parseInt(input.value, 10);
      const badge = dialog.querySelector("#mod-" + key);
      if (badge && !isNaN(num)) {
        badge.textContent = signed(Math.floor((num - 10) / 2));
      }
    });
  });
}

export function openDetailsEditor({character, onSave}) {
  const formHtml = `
    <div class="subeditor-grid">
      <label style="grid-column: 1 / -1;">
        Character name
        <input type="text" name="name" value="${escape(character.name || "")}" required maxlength="120">
      </label>
      <label>
        Class &amp; Subclass
        <input type="text" name="characterClass" data-suggest="classes" value="${escape(character.characterClass || "")}" placeholder="e.g. Druid, Fighter" maxlength="120">
      </label>
      <label>
        Species / Lineage
        <input type="text" name="species" data-suggest="species" value="${escape(character.species || "")}" placeholder="e.g. Human, Elf" maxlength="120">
      </label>
      <label>
        Level
        <input type="number" name="level" value="${character.level != null ? character.level : 1}" min="1" max="20" required>
      </label>
      <label>
        Background
        <input type="text" name="background" data-suggest="backgrounds" value="${escape(character.background || "")}" placeholder="e.g. Folk Hero, Acolyte" maxlength="120">
      </label>
      <label>
        Alignment
        <input type="text" name="alignment" value="${escape(character.alignment || "")}" placeholder="e.g. Neutral Good" maxlength="60">
      </label>
      <label>
        Player name
        <input type="text" name="player" value="${escape(character.player || "")}" placeholder="Player name" maxlength="100">
      </label>
      <label>
        Experience points (XP)
        <input type="number" name="xp" value="${character.xp != null ? character.xp : ""}" min="0" placeholder="0">
      </label>
    </div>
  `;

  openSubeditor({
    title: "Edit character details",
    subtitle: `Update identity and profile for ${character.name}`,
    iconName: "users",
    formHtml,
    onSave: (data) => {
      const name = data.get("name")?.trim();
      if (!name) throw new Error("Character name is required.");
      const characterClass = data.get("characterClass")?.trim() || "";
      const species = data.get("species")?.trim() || "";
      const levelStr = data.get("level")?.trim();
      const level = levelStr ? Number.parseInt(levelStr, 10) : 1;
      const background = data.get("background")?.trim() || "";
      const alignment = data.get("alignment")?.trim() || "";
      const player = data.get("player")?.trim() || "";
      const xpStr = data.get("xp")?.trim();
      const xp = xpStr ? Number.parseInt(xpStr, 10) : null;

      return onSave({
        name, characterClass, species, level, background, alignment, player, xp
      });
    }
  });
}

export function openSkillsEditor({character, skills, onSave}) {
  const currentSkill = new Map((character.skills || []).map((s) => [s.name.toLowerCase(), s]));
  const edits = character.sheetEdits?.training || {};

  const formHtml = `
    <div class="subeditor-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">
      ${skills.map(([name, label]) => {
        const skill = currentSkill.get(name);
        const currentRank = edits[name] ?? (
          character.rulesDetails?.skillTraining?.some((s) => s.toLowerCase() === name.toLowerCase()) ? 1 :
          (skill?.bonus != null && character.proficiency && skill.base != null && skill.bonus === skill.base + 2 * character.proficiency) ? 2 :
          (skill?.bonus != null && character.proficiency && skill.base != null && skill.bonus === skill.base + character.proficiency) ? 1 :
          0
        );
        return `
          <label>
            ${escape(label)}
            <select name="skill-${escape(name)}">
              <option value="0"${currentRank === 0 ? " selected" : ""}>Untrained</option>
              <option value="1"${currentRank === 1 ? " selected" : ""}>Proficient</option>
              <option value="2"${currentRank === 2 ? " selected" : ""}>Expertise</option>
            </select>
          </label>
        `;
      }).join("")}
    </div>
  `;

  openSubeditor({
    title: "Edit skill proficiencies",
    subtitle: `Update trained skills and expertise for ${character.name}`,
    iconName: "award",
    formHtml,
    onSave: (data) => {
      const training = {};
      for (const [name] of skills) {
        const rank = data.get("skill-" + name);
        if (["0", "1", "2"].includes(rank)) {
          training[name] = Number.parseInt(rank, 10);
        }
      }
      return onSave(training);
    }
  });
}

export function openSpellEditor({character, spellIndex = -1, onSave}) {
  const isEdit = spellIndex >= 0 && character.spells?.[spellIndex];
  const spell = isEdit ? character.spells[spellIndex] : {name: "", level: 0, prepared: false, note: ""};

  let rawName = spell.name || "";
  let rawNote = spell.note || "";
  if (!rawNote) {
    for (const match of rawName.matchAll(/\s(?=\(|[-–—]\s)/g)) {
      const note = rawName.slice(match.index + 1);
      if (match.index <= 100 && (note.length >= 100 || (note.startsWith("(") && /^\([^)]{0,70}\)/.test(note)))) {
        rawName = rawName.slice(0, match.index);
        rawNote = note.replace(/^\(|\)$/g, "");
        break;
      }
    }
  }

  const levels = [
    [0, "Cantrip"], [1, "1st Level"], [2, "2nd Level"], [3, "3rd Level"],
    [4, "4th Level"], [5, "5th Level"], [6, "6th Level"], [7, "7th Level"],
    [8, "8th Level"], [9, "9th Level"]
  ];

  const formHtml = `
    <input type="hidden" name="source" value="${escape(spell.source??'')}">
    <label>
      Spell name
      <input type="text" name="name" data-suggest="spells" value="${escape(rawName)}" placeholder="e.g. Cure Wounds, Shield, Fireball" required maxlength="120">
    </label>
    <div class="subeditor-grid">
      <label>
        Spell level
        <select name="level">
          ${levels.map(([lvl, lbl]) => `<option value="${lvl}"${spell.level === lvl ? " selected" : ""}>${lbl}</option>`).join("")}
        </select>
      </label>
      <label class="sheet-editor-check subeditor-prepared">
        <input type="checkbox" name="prepared"${spell.prepared ? " checked" : ""}>
        <span>Prepared spell</span>
      </label>
    </div>
    <label>
      Notes / Casting description
      <textarea name="note" placeholder="Components, casting time, range, saving throw…">${escape(rawNote)}</textarea>
    </label>
  `;

  openSubeditor({
    title: isEdit ? "Edit spell" : "Add spell",
    subtitle: isEdit ? `Modify details for ${rawName}` : `Add a spell to ${character.name}`,
    iconName: "sparkles",
    formHtml,
    onSave: (data) => {
      const name = data.get("name")?.trim();
      if (!name) throw new Error("Spell name is required.");
      const level = Number.parseInt(data.get("level") || "0", 10);
      const prepared = data.has("prepared");
      const note = data.get("note")?.trim() || "";
      const formattedName = note ? `${name} (${note})` : name;

      return onSave({
        name: formattedName,
        level,
        prepared,
        source: data.get("source") || undefined,
        note
      });
    }
  });
}

export function openSlotsEditor({character, onSave}) {
  const currentSlots = character.spellSlots || {};
  const edits = character.sheetEdits?.slots || {};

  const formHtml = `
    <div class="subeditor-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">
      ${Array.from({length: 9}, (_, i) => i + 1).map((rank) => {
        const slot = currentSlots[rank] || {};
        const editSlot = edits[rank] || {};
        const max = editSlot.maximum ?? slot.maximum ?? "";
        const cur = editSlot.current ?? slot.current ?? "";
        return `
          <div style="border: 1px solid var(--border); border-radius: 8px; padding: 10px;">
            <strong style="display:block; margin-bottom:6px; font-size:.92rem;">Level ${rank}</strong>
            <div style="display:flex; gap:8px;">
              <label style="font-size:.78rem;">Remaining
                <input type="number" name="current-${rank}" value="${cur}" min="0" max="20" placeholder="0">
              </label>
              <label style="font-size:.78rem;">Maximum
                <input type="number" name="maximum-${rank}" value="${max}" min="0" max="20" placeholder="0">
              </label>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  openSubeditor({
    title: "Edit spell slots",
    subtitle: `Adjust slot counts for ${character.name}`,
    iconName: "sparkles",
    formHtml,
    onSave: (data) => {
      const slots = {};
      for (let rank = 1; rank <= 9; rank++) {
        const curStr = data.get(`current-${rank}`)?.trim();
        const maxStr = data.get(`maximum-${rank}`)?.trim();
        if (curStr || maxStr) {
          const current = curStr ? Number.parseInt(curStr, 10) : 0;
          const maximum = maxStr ? Number.parseInt(maxStr, 10) : current;
          if (current > maximum) {
            throw new Error(`Level ${rank} remaining slots cannot exceed maximum.`);
          }
          slots[rank] = {current, maximum};
        }
      }
      return onSave(slots);
    }
  });
}
