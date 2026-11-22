import {escape, text} from "./format.mjs";
import {featureChoiceEditor} from "./class-feature-view.mjs";

const identity = [["characterClass","Class and subclass"],["species","Species"],["background","Background"],["startingClass","Starting class for multiclassing"]];
const combat = [
  ["ac","Armor Class",0,60],["maxHp","Maximum HP",1,2000],["hp","Starting HP",0,2000],
  ["speed","Walking speed (ft)",0,500],["initiative","Initiative",-50,50],["proficiency","Proficiency bonus",0,20],
  ["passivePerception","Passive Perception",0,100],
];
const casting = [["spellDC","Spell save DC",0,60],["spellAttack","Spell attack bonus",-50,50]];
const armor = {
  unarmored:["Unarmored (10 + Dexterity modifier)",10,Infinity],padded:["Padded",11,Infinity],leather:["Leather",11,Infinity],
  "studded-leather":["Studded Leather",12,Infinity],hide:["Hide",12,2],"chain-shirt":["Chain Shirt",13,2],
  "scale-mail":["Scale Mail",14,2],breastplate:["Breastplate",14,2],"half-plate":["Half Plate",15,2],
  "ring-mail":["Ring Mail",14,null],"chain-mail":["Chain Mail",16,null],splint:["Splint",17,null],plate:["Plate",18,null],
};
const abilities = [["str","Strength"],["dex","Dexterity"],["con","Constitution"],["int","Intelligence"],["wis","Wisdom"],["cha","Charisma"]];
const ranks = Array.from({length:9},(_,i) => i+1);
const listFields = [["languages","Chosen languages"],["tools","Chosen tools"],["feats","Chosen feats"]];
const fields = [...identity,...listFields];
const numbers = [["level","Level",1,20],...combat,...casting];
const has = (object,key) => Object.hasOwn(object,key);

export function wornArmorClass(worn, dexterity, shield) {
  if (!has(armor,worn)) return null;
  const [,base,cap] = armor[worn];
  if (cap !== null && !Number.isFinite(dexterity)) return null;
  return base + (cap === null ? 0 : Math.min(cap,dexterity)) + (shield ? 2 : 0);
}

export function sheetOverrides(record) {
  const edits = record.sheetEdits ?? {};
  const result = {...record};
  for (const [key] of [...fields,...numbers]) if (has(edits,key)) result[key] = edits[key];
  if (has(edits,"speed")) result.speed = String(edits.speed);
  if (edits.spellcastingAbility) {
    result.spellcastingAbility = edits.spellcastingAbility;
    if (!has(edits,"spellDC")) result.spellDC = null;
    if (!has(edits,"spellAttack")) result.spellAttack = null;
  }
  if (edits.training?.perception != null && !has(edits,"passivePerception")) result.passivePerception = null;
  result.abilities = (record.abilities ?? []).map((ability) => {
    const score = edits.scores?.[ability.abbr.toLowerCase()];
    if (!Number.isFinite(score)) return ability;
    const previous = ability.modifier ?? (Number.isFinite(ability.score) ? Math.floor((ability.score-10)/2) : null);
    const modifier = Math.floor((score-10)/2);
    const save = Number.isFinite(previous) && Number.isFinite(ability.save) ? ability.save+modifier-previous : ability.save;
    return {...ability,score,modifier,save};
  });
  result.spellSlots = {...record.spellSlots};
  for (const [rank,values] of Object.entries(edits.slots ?? {})) {
    result.spellSlots[rank] = {...result.spellSlots[rank],...values};
  }
  return result;
}

function readNumber(data, key, label, min, max) {
  const value = String(data.get(key) ?? "").trim();
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(label + ` must be a whole number from ${min} to ${max}.`);
  return number;
}

export function readSheetEdits(data, skills, character) {
  const result = {};
  for (const [key] of identity) {
    const value = data.get(key)?.trim();
    if (value) result[key] = value.slice(0,160);
  }
  for (const [key] of listFields) {
    const values = data.get(key)?.split(",").map((value) => value.trim()).filter(Boolean);
    if (values?.length) result[key] = [...new Set(values)];
  }
  for (const [key,label,min,max] of numbers) {
    const number = readNumber(data,key,label,min,max);
    if (number !== undefined) result[key] = number;
  }
  const worn = data.get("armor");
  if (has(armor,worn)) result.armor = worn;
  if (data.has("shield")) {
    if (!result.armor && result.ac == null) throw new Error("Choose worn armor or enter Armor Class to record a shield.");
    result.shield = true;
  }
  if (data.has("fixedHp")) result.fixedHp = true;
  const castingAbility = data.get("spellcastingAbility");
  if (abilities.some(([key]) => key === castingAbility)) result.spellcastingAbility = castingAbility;
  const scores = {};
  for (const [key,label] of abilities) {
    const score = readNumber(data,"score-"+key,label,1,30);
    if (score !== undefined) scores[key] = score;
  }
  if (Object.keys(scores).length) result.scores = scores;
  const training = {};
  for (const [name] of skills) {
    const rank = data.get("skill-"+name);
    if (["0","1","2"].includes(rank)) training[name] = Number(rank);
  }
  if (Object.keys(training).length) result.training = training;
  const slots = {};
  for (const rank of ranks) {
    const maximum = readNumber(data,"maximum-"+rank,`Level ${rank} maximum slots`,0,20);
    const current = readNumber(data,"current-"+rank,`Level ${rank} remaining slots`,0,20);
    if (maximum !== undefined || current !== undefined) slots[rank] = {
      ...(maximum !== undefined ? {maximum} : {}),...(current !== undefined ? {current} : {}),
    };
  }
  if (Object.keys(slots).length) result.slots = slots;
  const subclasses = {}, classLevels = {}, featureChoices = {}, featureNotes = {};
  const details = character?.rulesDetails?.classDetails;
  for (const cls of details?.classes ?? []) {
    const level = readNumber(data,"class-level-"+cls.id,cls.name+" level",1,20);
    if (level !== undefined) classLevels[cls.id] = level;
    const selected = data.get("class-subclass-"+cls.id);
    if (selected === "" || cls.subclasses.some(({id}) => id === selected)) subclasses[cls.id] = selected;
  }
  for (const choice of details?.choices ?? []) {
    if (!data.has("choice-present-"+choice.id)) continue;
    const selected = [...new Set(data.getAll("feature-choice-"+choice.id))];
    if (!choice.minimum && selected.length > choice.count) {
      const imported=["spells","prepared"].includes(choice.kind) && !character.sheetEdits?.featureChoices?.[choice.id] &&
        choice.inferred?.length===selected.length && choice.inferred.every(id=>selected.includes(id));
      // Preserve an unresolved imported list while other sheet fields are edited.
      // It remains flagged for review until the player records a legal selection.
      if(imported) continue;
      throw new Error(choice.label+" allows "+choice.count+" choices.");
    }
    if (selected.some((id) => !choice.options.some((entry) => entry.id === id))) throw new Error("Choose an available feature.");
    for (const id of selected) {
      const entry=choice.options.find(entry=>entry.id===id);
      if(entry.disabled) throw new Error(entry.name+" requires "+entry.requires+".");
    }
    featureChoices[choice.id] = selected;
    const note = String(data.get("feature-note-"+choice.id) ?? "").trim();
    if (note) featureNotes[choice.id] = note.slice(0,300);
  }
  const expertise=new Set();
  for(const choice of details?.choices.filter(choice=>choice.kind==="expertise") ?? []) {
    for(const name of featureChoices[choice.id] ?? []) {
      if(expertise.has(name)) throw new Error("Choose different skills for each Expertise selection.");
      expertise.add(name);
    }
  }
  if (Object.keys(classLevels).length) result.classLevels = classLevels;
  if (Object.keys(subclasses).length) result.subclasses = subclasses;
  if (Object.keys(featureChoices).length) result.featureChoices = featureChoices;
  if (Object.keys(featureNotes).length) result.featureNotes = featureNotes;
  const resources = {};
  for (const [key,pool] of Object.entries(character?.resources ?? {})) {
    const current = readNumber(data,"resource-"+key,pool.name+" remaining",0,pool.maximum);
    if (current !== undefined) resources[key] = current;
  }
  if (Object.keys(resources).length) result.resources = resources;
  return result;
}

export function validateSheetEdits(character) {
  const edits = character.sheetEdits ?? {};
  const knownClasses = character.rulesDetails?.classDetails?.classes ?? [];
  const classTotal = Object.values(edits.classLevels ?? {}).reduce((total,value) => total+value,0);
  if (knownClasses.length && classTotal && classTotal !== character.level) {
    throw new Error("Class levels must add up to the character’s total level.");
  }
  if (edits.armor && edits.ac == null && character.rulesDetails.wornAC == null) {
    throw new Error("Enter Dexterity or enter Armor Class directly.");
  }
  if (edits.fixedHp && edits.maxHp == null && character.rulesDetails.fixedMaximum == null) {
    throw new Error("Fixed HP needs Constitution, known class levels, and the starting class for a multiclass character. Enter maximum HP directly if your build varies.");
  }
  if ((edits.hp != null || edits.maxHp != null || edits.fixedHp) && Number.isFinite(character.hp) &&
      Number.isFinite(character.maxHp) && character.hp > character.maxHp) {
    throw new Error("Starting HP cannot exceed maximum HP.");
  }
  for (const rank of Object.keys(edits.slots ?? {})) {
    const pool = character.spellSlots[rank];
    if (Number.isFinite(pool.current) && Number.isFinite(pool.maximum) && pool.current > pool.maximum) {
      throw new Error(`Level ${rank} remaining slots cannot exceed the maximum.`);
    }
  }
}

function numberField([key,label,min,max], current, edits, name = key) {
  return `<label>${escape(label)}<input type="number" name="${escape(name)}" min="${min}" max="${max}" step="1"
    value="${escape(edits[key])}" placeholder="${escape(current)}"></label>`;
}

function selectOption(value,label,selected) {
  return `<option value="${escape(value)}"${String(selected ?? "") === String(value) ? " selected" : ""}>${escape(label)}</option>`;
}

export function sheetEditor(character, skills) {
  const edits = character.sheetEdits ?? {};
  const walking = Number.parseInt(character.speed,10);
  const currentSkill = new Map(character.skills.map((skill) => [skill.name.toLowerCase(),skill]));
  const hasCasting = character.spells.length || Object.keys(character.spellSlots ?? {}).length;
  return `<form id="character-edit-form" class="sheet-box sheet-editor">
    <header class="sheet-box-heading"><h2>Complete character sheet</h2><button class="button primary small" type="submit">Save changes</button></header>
    <p class="sheet-editor-note">Blank fields use the workbook or the rules. New tokens start with these values.</p>
    <p id="character-edit-status" class="sheet-editor-note" role="status"></p>
    <fieldset><legend>Character and level</legend><div class="sheet-editor-grid">
      ${identity.map(([key,label]) => `<label>${escape(label)}<input name="${key}" maxlength="160" value="${escape(edits[key])}"
        placeholder="${escape(character[key])}"></label>`).join("")}
      ${numberField(numbers[0],character.level,edits)}
    </div></fieldset>
    <fieldset><legend>Combat stats</legend><div class="sheet-editor-grid">
      ${combat.map((field) => numberField(field,field[0] === "speed" ? Number.isFinite(walking) ? walking : "" : character[field[0]],edits)).join("")}
      <label>Worn armor<select name="armor" aria-label="Worn armor">${selectOption("","Use sheet AC",edits.armor)}
        ${Object.entries(armor).map(([key,[label]]) => selectOption(key,label,edits.armor)).join("")}</select></label>
      <label class="sheet-editor-check"><input type="checkbox" name="shield"${edits.shield ? " checked" : ""}> Wear a shield</label>
      <label class="sheet-editor-check"><input type="checkbox" name="fixedHp"${edits.fixedHp ? " checked" : ""}> Use fixed HP by class level</label>
    </div><p class="sheet-editor-detail">Direct AC and maximum HP entries take priority. Use them for magic gear, special defenses, or rolled HP.</p></fieldset>
    ${featureChoiceEditor(character)}
    ${Object.keys(character.resources ?? {}).length ? `<fieldset><legend>Class resources</legend><div class="sheet-editor-grid">
      ${Object.entries(character.resources).map(([key,pool]) => numberField(["resource-"+key,pool.name+" remaining / "+pool.maximum,0,pool.maximum],
        pool.current,{["resource-"+key]:edits.resources?.[key]})).join("")}</div></fieldset>` : ""}
    <details><summary>Ability scores and training</summary>
      <fieldset><legend>Ability scores</legend><div class="sheet-editor-grid">${abilities.map(([key,label]) =>
        numberField([key,label,1,30],character.abilities.find(({abbr}) => abbr.toLowerCase() === key)?.score,edits.scores ?? {},"score-"+key)).join("")}</div></fieldset>
      <fieldset><legend>Skill training</legend><div class="sheet-editor-grid">${skills.map(([name,label]) => {
        const current = currentSkill.get(name)?.bonus;
        return `<label>${escape(label)}<select name="skill-${escape(name)}" aria-label="${escape(label)}">${selectOption("",Number.isFinite(current) ? "Use sheet or rules ("+text(current)+")" : "Use sheet or rules",edits.training?.[name])}
          ${[[0,"Untrained"],[1,"Proficient"],[2,"Expertise"]].map(([rank,option]) => selectOption(rank,option,edits.training?.[name])).join("")}</select></label>`;
      }).join("")}</div></fieldset>
      <fieldset><legend>Other choices</legend><div class="sheet-editor-grid">${listFields.map(([key,label]) => `<label>${label}<input name="${key}" maxlength="260"
        placeholder="Separate choices with commas" value="${escape(edits[key]?.join(", "))}"></label>`).join("")}</div></fieldset>
    </details>
    <details${hasCasting ? " open" : ""}><summary>Spellcasting and slots</summary>
      <fieldset><legend>Spellcasting</legend><div class="sheet-editor-grid">
        <label>Spellcasting ability<select name="spellcastingAbility" aria-label="Spellcasting ability">${selectOption("",
          character.spellcastingAbility && !edits.spellcastingAbility ? `Use sheet or class (${character.spellcastingAbility})` : "Use sheet or class",edits.spellcastingAbility)}
          ${abilities.map(([key,label]) => selectOption(key,label,edits.spellcastingAbility)).join("")}</select></label>
        ${casting.map((field) => numberField(field,character[field[0]],edits)).join("")}
      </div></fieldset>
      <fieldset><legend>Spell slots</legend><div class="sheet-editor-slots">
        ${ranks.map((rank) => {
          const slot = character.spellSlots?.[rank];
          const values = edits.slots?.[rank] ?? {};
          return `<div><strong>Level ${rank}</strong>
            ${numberField(["maximum-"+rank,"Level "+rank+" maximum",0,20],slot?.maximum,{["maximum-"+rank]:values.maximum})}
            ${numberField(["current-"+rank,"Level "+rank+" remaining",0,20],slot?.current,{["current-"+rank]:values.current})}
          </div>`;
        }).join("")}
      </div></fieldset>
    </details>
    <div class="sheet-editor-foot"><button class="button primary" type="submit">Save sheet</button></div>
  </form>`;
}
