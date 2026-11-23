import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {characterPage} from "../dist/character-view.mjs";
import {sheetEditor} from "../dist/sheet-editor.mjs";
import {enrichCharacter, loadCharacterRules, sheetSkills} from "../dist/character-rules.mjs";

globalThis.fetch = async (path) => new Response(await readFile(new URL("../dist/" + path, import.meta.url)));
await loadCharacterRules();

const testCharacter = enrichCharacter({
  id: "test-hero-1",
  name: "Althea Brightwood",
  characterClass: "Druid",
  species: "Human",
  level: 3,
  background: "Folk Hero",
  alignment: "Neutral Good",
  player: "Player One",
  xp: 900,
  ac: 14,
  initiative: 2,
  speed: "30",
  hp: 24,
  maxHp: 24,
  tempHp: 0,
  proficiency: 2,
  passivePerception: 15,
  abilities: [
    {abbr: "STR", label: "Strength", score: 10, modifier: 0, save: 0},
    {abbr: "DEX", label: "Dexterity", score: 14, modifier: 2, save: 2},
    {abbr: "CON", label: "Constitution", score: 14, modifier: 2, save: 2},
    {abbr: "INT", label: "Intelligence", score: 12, modifier: 1, save: 1},
    {abbr: "WIS", label: "Wisdom", score: 16, modifier: 3, save: 5},
    {abbr: "CHA", label: "Charisma", score: 10, modifier: 0, save: 0},
  ],
  skills: [
    {name: "Animal Handling", bonus: 5, base: 3},
    {name: "Nature", bonus: 3, base: 1},
    {name: "Perception", bonus: 5, base: 3},
    {name: "Survival", bonus: 5, base: 3},
  ],
  attacks: [
    {name: "Scimitar", bonus: 4, damage: "1d6+2 slashing"},
    {name: "Produce Flame", bonus: 5, damage: "1d8 fire"},
  ],
  items: [
    {name: "Leather Armor", quantity: 1, weight: 10},
    {name: "Wooden Shield", quantity: 1, weight: 6},
    {name: "Druidic Focus (Mistletoe)", quantity: 1, weight: 0},
    {name: "Goodberry", quantity: 10, weight: 0},
  ],
  spells: [
    {name: "Druidcraft", level: 0, prepared: false},
    {name: "Shape Water", level: 0, prepared: false},
    {name: "Entangle", level: 1, prepared: true},
    {name: "Healing Word", level: 1, prepared: true},
    {name: "Pass without Trace", level: 2, prepared: true},
  ],
  spellSlots: {
    "1": {current: 4, maximum: 4},
    "2": {current: 2, maximum: 2},
  },
  spellcastingAbility: "Wisdom",
  spellDC: 13,
  spellAttack: 5,
});

// 1. Verify sheetEditor autofills current values in value attributes
const editorHtml = sheetEditor(testCharacter, sheetSkills);
assert.match(editorHtml, /name="characterClass"[^>]*value="Druid"/, "Class is autofilled in value");
assert.match(editorHtml, /name="species"[^>]*value="Human"/, "Species is autofilled in value");
assert.match(editorHtml, /name="level"[^>]*value="3"/, "Level is autofilled in value");
assert.match(editorHtml, /name="ac"[^>]*value="14"/, "AC is autofilled in value");
assert.match(editorHtml, /name="maxHp"[^>]*value="24"/, "Max HP is autofilled in value");
assert.match(editorHtml, /name="hp"[^>]*value="24"/, "HP is autofilled in value");
assert.match(editorHtml, /name="initiative"[^>]*value="2"/, "Initiative is autofilled in value");
assert.match(editorHtml, /name="score-wis"[^>]*value="16"/, "Wisdom score is autofilled in value");
assert.match(editorHtml, /name="score-dex"[^>]*value="14"/, "Dexterity score is autofilled in value");
assert.match(editorHtml, /name="maximum-1"[^>]*value="4"/, "Level 1 max spell slots autofilled");
assert.match(editorHtml, /name="current-1"[^>]*value="4"/, "Level 1 current spell slots autofilled");
assert.match(editorHtml, /name="maximum-2"[^>]*value="2"/, "Level 2 max spell slots autofilled");

// 2. Verify Overview section has quick-edit buttons
const overviewHtml = characterPage(testCharacter, "overview");
assert.match(overviewHtml, /data-action="edit-vitals"/, "Vitals have edit button");
assert.match(overviewHtml, /data-action="edit-abilities"/, "Ability scores have edit button");
assert.match(overviewHtml, /data-action="edit-details"/, "Character details have edit button");
assert.match(overviewHtml, /data-action="add-attack"/, "Quick actions have add action button");
assert.match(overviewHtml, /data-action="edit-attack"/, "Attacks have edit action button");
assert.match(overviewHtml, /data-action="delete-attack"/, "Attacks have delete action button");

// 3. Verify Actions section has edit and delete controls
const actionsHtml = characterPage(testCharacter, "actions");
assert.match(actionsHtml, /data-action="add-attack"/, "Actions section has add attack button");
assert.match(actionsHtml, /data-action="edit-attack"[^>]*data-index="0"/, "First attack has edit control");
assert.match(actionsHtml, /data-action="delete-attack"[^>]*data-index="0"/, "First attack has delete control");

// 4. Verify Skills & Saves section has edit training button
const skillsHtml = characterPage(testCharacter, "skills");
assert.match(skillsHtml, /data-action="edit-skills"/, "Skills section has edit training button");

// 5. Verify Inventory section has Add item button
const inventoryHtml = characterPage(testCharacter, "inventory");
assert.match(inventoryHtml, /data-action="add-item"/, "Inventory section has add item button");

// 6. Verify Spells section has Add spell and Edit slots buttons
const spellsHtml = characterPage(testCharacter, "spells");
assert.match(spellsHtml, /data-action="add-spell"/, "Spells section has add spell button");
assert.match(spellsHtml, /data-action="edit-slots"/, "Spells section has edit slots button");

console.log("All sheet editor autofill and section direct-edit verification tests passed successfully!");
