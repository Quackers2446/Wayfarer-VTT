import {escape} from "./format.mjs";
import {formatEntries} from "./rules-library.mjs";

const option = (value,label,selected) => '<option value="'+escape(value)+'"'+(selected ? ' selected' : '')+'>'+escape(label)+'</option>';

export function featureChoiceEditor(character) {
  const details = character.rulesDetails?.classDetails;
  if (!details) return "";
  return `<fieldset class="class-build"><legend>Class choices and features</legend>
    <p class="sheet-editor-detail">Selections already shown in the workbook are retained. Record past ability improvements without adding them to the scores again.</p>
    ${details.classes.map((cls) => `<div class="class-build-heading"><h3>${escape(cls.name)} · ${escape(cls.source)}</h3>
      <div class="sheet-editor-grid">
        <label>${escape(cls.name)} level<input type="number" name="class-level-${escape(cls.id)}" min="1" max="20" value="${escape(cls.level)}"></label>
        <label>${escape(cls.subclassTitle)}<select name="class-subclass-${escape(cls.id)}" aria-label="${escape(cls.subclassTitle)}">
          ${option("","Choose a subclass",!cls.subclassId)}
          ${cls.subclasses.map((entry) => option(entry.id,entry.name+" ("+entry.source+")",entry.id === cls.subclassId)).join("")}
        </select></label>
      </div></div>`).join("")}
    ${details.choices.map((choice) => `<details class="feature-choice"${choice.remaining && !choice.optional ? " open" : ""}>
      <summary>${escape(choice.label)} <span>${choice.selected.length} / ${choice.count}${choice.optional ? " optional" : ""}</span></summary>
      <input type="hidden" name="choice-present-${escape(choice.id)}" value="1">
      ${choice.instruction ? "<p class=\"sheet-editor-detail\">"+escape(choice.instruction)+"</p>" : ""}
      ${choice.options.length > 15 ? `<label class="feature-search">Filter choices<input type="search" class="feature-choice-search" placeholder="Search choices"></label>` : ""}
      <div class="feature-choice-options">${choice.options.length > 15 ? `<label>${escape(choice.label)}
        <select multiple size="7" name="feature-choice-${escape(choice.id)}" aria-label="${escape(choice.label)}">
        ${choice.options.map((entry) => option(entry.id,entry.name+(entry.source ? " ("+entry.source+")" : ""),choice.selected.includes(entry.id))).join("")}
        </select></label>` : choice.options.map((entry) => `<div class="feature-choice-option" data-choice-name="${escape(entry.name.toLowerCase())}">
        <label class="sheet-editor-check"><input type="checkbox" name="feature-choice-${escape(choice.id)}"
          value="${escape(entry.id)}"${choice.selected.includes(entry.id) ? " checked" : ""}>
          <span>${escape(entry.name)}${entry.source ? " · "+escape(entry.source) : ""}</span></label>
        ${entry.entries ? `<details><summary>Rules</summary>${formatEntries(entry.entries)}</details>` : ""}
        ${entry.prerequisite ? '<small>Prerequisites apply. Check the feature rules for your build.</small>' : ""}
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
  const unchosen = details.classes.filter((cls) => !cls.subclass && cls.level >= 3);
  return `<section class="sheet-box class-features">
    <header class="sheet-box-heading"><h2>Class features</h2></header>
    ${Object.entries(character.resources ?? details.pools).length ? `<dl class="sheet-slot-summary">${Object.entries(character.resources ?? details.pools).map(([,pool]) =>
      `<div><dt>${escape(pool.name)}</dt><dd>${pool.current != null ? escape(pool.current)+" / " : ""}${escape(pool.maximum)}</dd>
      <small>${pool.rest === "short" ? "Short or long rest" : "Long rest"}</small></div>`).join("")}</dl>` : ""}
    ${unchosen.map((cls) => `<p class="sheet-rules-note">Choose ${escape(cls.name)}’s ${escape(cls.subclassTitle.toLowerCase())} in Edit sheet.</p>`).join("")}
    ${details.choices.filter((choice) => !choice.optional && choice.remaining).map((choice) =>
      `<p class="sheet-rules-note">${escape(choice.label)} · ${choice.remaining} choice${choice.remaining === 1 ? "" : "s"} to record.</p>`).join("")}
    ${details.features.map((feature) => `<details class="class-feature-rule">
      <summary><strong>${escape(feature.name)}</strong> <span>Level ${feature.level} · ${escape(feature.source)}</span></summary>
      ${formatEntries(feature.entries)}
    </details>`).join("")}
  </section>`;
}
