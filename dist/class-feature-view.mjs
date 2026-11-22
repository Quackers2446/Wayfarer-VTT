import {escape} from "./format.mjs";
import {formatEntries} from "./rules-library.mjs";

const option = (value,label,selected,disabled=false) => '<option value="'+escape(value)+'"'+(selected ? ' selected' : '')+(disabled && !selected ? ' disabled' : '')+'>'+escape(label)+'</option>';

const activeFeatures=new Set(["Ki","Martial Arts","Flurry of Blows","Patient Defense","Step of the Wind","Stunning Strike","Focused Aim",
  "Quickened Healing","Ki-Fueled Attack","Cunning Action","Second Wind","Action Surge","Bardic Inspiration","Master of Tactics","Steady Aim","Bladesong","Stillness of Mind"]);
const automaticFeatures=new Set(["Unarmored Defense","Unarmored Movement","Extra Attack","Sneak Attack","Evasion","Ki-Empowered Strikes","Reliable Talent","Font of Inspiration","Jack of All Trades"]);
function featureMode(feature) {
  const name=feature.name.replace(/ \(.*\)$/,'');
  if(activeFeatures.has(name)) return "Play controls";
  if(automaticFeatures.has(name)) return "Automatic";
  if(name==="Deflect Missiles") return "Reaction controls";
  if(name==="Slow Fall") return "Tools · falling damage";
  if(["Ability Score Improvement","Expertise","Dedicated Weapon"].includes(name)) return "Build choice";
  if(["Spellcasting","Pact Magic"].includes(name)) return "Spells and slots";
  if(["Way of the Astral Self","Visage of the Astral Self"].includes(name)) return "Play controls and rules";
  return "Rules reference";
}

export function featureChoiceEditor(character) {
  const details = character.rulesDetails?.classDetails;
  if (!details) return "";
  return `<fieldset class="class-build"><legend>Class choices and features</legend>
    <p class="sheet-editor-detail">Selections already shown in the workbook are retained. Record past ability improvements without adding them to the scores again.</p>
    <p class="sheet-editor-detail">Save after changing a class level, subclass, or optional feature to load its dependent choices. Automatic class features are granted at their required level.</p>
    ${details.classes.map((cls) => `<div class="class-build-heading"><h3>${escape(cls.name)} · ${escape(cls.source)}</h3>
      <div class="sheet-editor-grid">
        <label>${escape(cls.name)} level<input type="number" name="class-level-${escape(cls.id)}" min="1" max="20" value="${escape(cls.level)}"></label>
        <label>${escape(cls.subclassTitle)}<select name="class-subclass-${escape(cls.id)}" aria-label="${escape(cls.subclassTitle)}">
          ${option("","Choose a subclass",!cls.subclassId)}
          ${cls.subclasses.map((entry) => option(entry.id,entry.name+" ("+entry.source+")",entry.id === cls.subclassId)).join("")}
        </select></label>
      </div></div>`).join("")}
    ${details.choices.map((choice) => `<details class="feature-choice"${(choice.remaining || choice.over || choice.invalid?.length) && !choice.optional ? " open" : ""}>
      <summary>${escape(choice.label)} <span>${choice.selected.length} / ${choice.count}${choice.minimum ? "+" : ""}${choice.optional ? " optional" : ""}</span></summary>
      ${choice.over ? '<p class="sheet-rules-note">Choose '+choice.count+' options. The imported sheet currently lists '+choice.selected.length+'.</p>' : ""}
      ${choice.invalid?.length ? '<p class="sheet-rules-note">A selected option no longer meets its prerequisites. Remove it or complete the required choices.</p>' : ""}
      <input type="hidden" name="choice-present-${escape(choice.id)}" value="1">
      ${choice.instruction ? "<p class=\"sheet-editor-detail\">"+escape(choice.instruction)+"</p>" : ""}
      ${choice.options.length > 15 ? `<label class="feature-search">Filter choices<input type="search" class="feature-choice-search" placeholder="Search choices"></label>` : ""}
      <div class="feature-choice-options">${choice.options.length > 15 ? `<label>${escape(choice.label)}
        <select multiple size="7" name="feature-choice-${escape(choice.id)}" aria-label="${escape(choice.label)}">
        ${choice.options.map((entry) => option(entry.id,entry.name+(entry.source ? " ("+entry.source+")" : "")+(entry.requires ? " · Requires "+entry.requires : ""),choice.selected.includes(entry.id),entry.disabled)).join("")}
        </select></label>` : choice.options.map((entry) => `<div class="feature-choice-option" data-choice-name="${escape(entry.name.toLowerCase())}">
        <label class="sheet-editor-check"><input type="checkbox" name="feature-choice-${escape(choice.id)}"
          value="${escape(entry.id)}"${choice.selected.includes(entry.id) ? " checked" : ""}${entry.disabled && !choice.selected.includes(entry.id) ? " disabled" : ""}>
          <span>${escape(entry.name)}${entry.source ? " · "+escape(entry.source) : ""}</span></label>
        ${entry.entries ? `<details><summary>Rules</summary>${formatEntries(entry.entries)}</details>` : ""}
        ${entry.requires ? '<small>Requires '+escape(entry.requires)+'.</small>' : ""}
      </div>`).join("")}</div>
      ${choice.kind === "advancement" || choice.kind === "record" ? `<label>${choice.kind === "advancement" ? "Recorded improvement or feat details" : "Your choice"}
        <input name="feature-note-${escape(choice.id)}" maxlength="300" value="${escape(choice.note)}"
        placeholder="${choice.kind === "advancement" ? "For example, +2 Dexterity, included in the sheet" : "Record the choice described in this feature"}"></label>` : ""}
    </details>`).join("")}
  </fieldset>`;
}

export function featureRules(character) {
  const details = character.rulesDetails?.classDetails;
  if (!details) return "";
  const unchosen = details.classes.filter((cls) => !cls.subclass && cls.level >= cls.subclassLevel);
  return `<section class="sheet-box class-features">
    <header class="sheet-box-heading"><h2>Class features</h2></header>
    <p class="sheet-rules-note">Features and choices below come from the local 5etools data. Play controls appear in Abilities, attacks, or spells. Features marked “Rules reference” are not fully automated yet.</p>
    ${Object.entries(character.resources ?? details.pools).length ? `<dl class="sheet-slot-summary">${Object.entries(character.resources ?? details.pools).map(([,pool]) =>
      `<div><dt>${escape(pool.name)}</dt><dd>${pool.current != null ? escape(pool.current)+" / " : ""}${escape(pool.maximum)}</dd>
      <small>${pool.rest === "short" ? "Short or long rest" : "Long rest"}</small></div>`).join("")}</dl>` : ""}
    ${unchosen.map((cls) => `<p class="sheet-rules-note">Choose ${escape(cls.name)}’s ${escape(cls.subclassTitle.toLowerCase())} in Edit sheet.</p>`).join("")}
    ${details.classes.some(cls=>!cls.level) ? '<p class="sheet-rules-note">Record each class level in Edit sheet to unlock the correct features.</p>' : ""}
    ${details.needsStartingClass ? '<p class="sheet-rules-note">Choose the starting class in Edit sheet to populate starting and multiclass proficiencies.</p>' : ""}
    ${details.choices.filter(choice=>choice.over || choice.invalid?.length).map(choice=>'<p class="sheet-rules-note">'+escape(choice.label)+' · review the selected options in Edit sheet.</p>').join("")}
    ${details.choices.filter((choice) => !choice.optional && choice.remaining).map((choice) =>
      `<p class="sheet-rules-note">${escape(choice.label)} · ${choice.remaining} choice${choice.remaining === 1 ? "" : "s"} to record.</p>`).join("")}
    ${details.features.map((feature) => `<details class="class-feature-rule">
      <summary><strong>${escape(feature.name)}</strong> <span>Level ${feature.level} · ${escape(feature.source)} · ${featureMode(feature)}</span></summary>
      ${formatEntries(feature.entries)}
    </details>`).join("")}
  </section>`;
}
