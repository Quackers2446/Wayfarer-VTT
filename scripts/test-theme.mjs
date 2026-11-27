import assert from "node:assert/strict";
import {THEME_PRESETS, normalizeColors, saveThemePreference, readThemePreference, applyTheme, setThemePreset, setCustomTheme, THEME_STORAGE_KEY} from "../dist/theme.mjs";

const store = new Map();
globalThis.localStorage = {
  getItem(key) {return store.has(key) ? store.get(key) : null;},
  setItem(key, value) {store.set(key, String(value));},
  removeItem(key) {store.delete(key);},
};
globalThis.document = {
  documentElement: {dataset: {}, style: {props: {}, setProperty(k, v) {this.props[k] = v;}}},
  dispatchEvent() {},
};

assert.equal(THEME_PRESETS[0].id, "grove");
assert.equal(THEME_PRESETS.length, 7, "seven presets + Custom tile = eight choices");
assert.ok(THEME_PRESETS.some((entry) => entry.id === "veil"));
assert.ok(THEME_PRESETS.some((entry) => entry.id === "brass"));
assert.deepEqual(normalizeColors({ground: "#ABCDEF", bogus: "#000000"}), {
  ground: "#abcdef",
  panel: THEME_PRESETS[0].colors.panel,
  line: THEME_PRESETS[0].colors.line,
  text: THEME_PRESETS[0].colors.text,
  muted: THEME_PRESETS[0].colors.muted,
  accent: THEME_PRESETS[0].colors.accent,
});
assert.equal(normalizeColors({ground: "red"}).ground, THEME_PRESETS[0].colors.ground);

const frost = THEME_PRESETS.find((entry) => entry.id === "frost");
assert.ok(frost.colors.panel.startsWith("#14"), "Frost panel stays ice-blue");
assert.match(frost.colors.accent, /^#[89a-f]/i, "Frost accent reads cool, not gold");

const dusk = setThemePreset("dusk");
assert.equal(dusk.id, "dusk");
assert.equal(dusk.colors.ground, "#0e1424");
assert.equal(JSON.parse(store.get(THEME_STORAGE_KEY)).id, "dusk");
assert.equal(document.documentElement.style.props["--theme-ground"], "#0e1424");
assert.equal(document.documentElement.dataset.theme, "dusk");
assert.match(document.documentElement.style.props["--page"], /color-mix/);

const custom = setCustomTheme({ground: "#112233", panel: "#223344", line: "#334455", text: "#ffffff", muted: "#aabbcc", accent: "#ffcc00"});
assert.equal(custom.id, "custom");
assert.equal(readThemePreference().id, "custom");
assert.equal(readThemePreference().colors.accent, "#ffcc00");

const applied = applyTheme(saveThemePreference({id: "grove"}));
assert.equal(applied.id, "grove");
assert.equal(document.documentElement.style.props["--gold"], applied.colors.accent);

console.log("Theme presets, persistence, and CSS variable apply passed.");
