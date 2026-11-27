/** Display themes — device-local; base CSS colors drive game chrome and lobby accents. */

export const THEME_STORAGE_KEY = "wayfarer-theme-v1";

export const THEME_SLOTS = [
  {id: "ground", label: "Ground", hint: "Deepest background"},
  {id: "panel", label: "Panel", hint: "Raised surfaces"},
  {id: "line", label: "Line", hint: "Borders and rules"},
  {id: "text", label: "Text", hint: "Primary type"},
  {id: "muted", label: "Muted", hint: "Secondary type"},
  {id: "accent", label: "Accent", hint: "Highlights"},
];

const grove = {
  ground: "#14241c",
  panel: "#243f30",
  line: "#5a7a5e",
  text: "#f5f0df",
  muted: "#a9c4ae",
  accent: "#f0d189",
};

export const THEME_PRESETS = [
  {id: "grove", name: "Grove", blurb: "Forest table — the default Wayfarer look.", colors: grove},
  {
    id: "dusk",
    name: "Dusk",
    blurb: "Deep indigo for late sessions.",
    colors: {
      ground: "#0e1424",
      panel: "#1a2744",
      line: "#4a6290",
      text: "#eef2ff",
      muted: "#9eb0d4",
      accent: "#e0b86a",
    },
  },
  {
    id: "ember",
    name: "Ember",
    blurb: "Warm hearth tones.",
    colors: {
      ground: "#1a0f0c",
      panel: "#3a2218",
      line: "#8a5a3c",
      text: "#fff0e4",
      muted: "#d4a888",
      accent: "#f0a05a",
    },
  },
  {
    id: "frost",
    name: "Frost",
    blurb: "Ice-blue night table.",
    colors: {
      ground: "#0a1628",
      panel: "#143552",
      line: "#4a88b8",
      text: "#e8f4ff",
      muted: "#8eb8d8",
      accent: "#9fd0f0",
    },
  },
  {
    id: "ink",
    name: "Ink",
    blurb: "Near-black charcoal with bright parchment.",
    colors: {
      ground: "#090a0b",
      panel: "#1c1f24",
      line: "#5a6068",
      text: "#f7f2e6",
      muted: "#b0b6bc",
      accent: "#e8c878",
    },
  },
  {
    id: "veil",
    name: "Veil",
    blurb: "Deep violet for arcane nights.",
    colors: {
      ground: "#140c1c",
      panel: "#2a1840",
      line: "#7a58a8",
      text: "#f3eaff",
      muted: "#bba0d8",
      accent: "#d4a8ff",
    },
  },
  {
    id: "brass",
    name: "Brass",
    blurb: "Sunlit yellows and polished metal.",
    colors: {
      ground: "#1a1608",
      panel: "#3a3210",
      line: "#b89628",
      text: "#fff8dc",
      muted: "#d4c478",
      accent: "#ffe066",
    },
  },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLOT_IDS = THEME_SLOTS.map((slot) => slot.id);

export function normalizeColors(input, fallback = grove) {
  const out = {...fallback};
  if (!input || typeof input !== "object") return out;
  for (const id of SLOT_IDS) {
    const value = String(input[id] ?? "").trim();
    if (HEX.test(value)) out[id] = value.toLowerCase();
  }
  return out;
}

export function readThemePreference() {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") return {id: "grove", colors: {...grove}};
    if (raw.id === "custom") return {id: "custom", colors: normalizeColors(raw.colors)};
    const preset = THEME_PRESETS.find((entry) => entry.id === raw.id) || THEME_PRESETS[0];
    return {id: preset.id, colors: {...preset.colors}};
  } catch {
    return {id: "grove", colors: {...grove}};
  }
}

export function saveThemePreference(preference) {
  const id = preference?.id === "custom" ? "custom" : (THEME_PRESETS.find((entry) => entry.id === preference?.id)?.id || "grove");
  const colors = id === "custom"
    ? normalizeColors(preference.colors)
    : {...(THEME_PRESETS.find((entry) => entry.id === id)?.colors || grove)};
  const next = {id, colors};
  try {localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));} catch {}
  return next;
}

function mix(hex, cream, amount) {
  // amount = share of theme colour mixed into cream (0–1). Returned as color-mix for live CSS.
  return `color-mix(in srgb, ${cream} ${Math.round((1 - amount) * 100)}%, ${hex} ${Math.round(amount * 100)}%)`;
}

/** Paint CSS custom properties on :root so game + desk both pick them up. */
export function applyTheme(preference = readThemePreference()) {
  const colors = normalizeColors(
    preference.colors,
    preference.id === "custom" ? grove : (THEME_PRESETS.find((e) => e.id === preference.id)?.colors || grove),
  );
  const root = document.documentElement;
  root.dataset.theme = preference.id || "grove";
  root.style.setProperty("--theme-ground", colors.ground);
  root.style.setProperty("--theme-panel", colors.panel);
  root.style.setProperty("--theme-line", colors.line);
  root.style.setProperty("--theme-text", colors.text);
  root.style.setProperty("--theme-muted", colors.muted);
  root.style.setProperty("--theme-accent", colors.accent);

  // Desk / lobby: keep parchment readable, but tint clearly from the active theme.
  root.style.setProperty("--green", colors.panel);
  root.style.setProperty("--deep", colors.ground);
  root.style.setProperty("--darker", colors.ground);
  root.style.setProperty("--gold", colors.accent);
  root.style.setProperty("--ink", mix(colors.ground, "#273329", 0.45));
  root.style.setProperty("--muted", mix(colors.line, "#5b675d", 0.55));
  root.style.setProperty("--light-muted", colors.muted);
  root.style.setProperty("--page", mix(colors.panel, "#f8f6ef", 0.22));
  root.style.setProperty("--paper", mix(colors.panel, "#fdfcf7", 0.14));
  root.style.setProperty("--border", mix(colors.line, "#e2dfd2", 0.42));
  root.style.setProperty("--pale", mix(colors.panel, "#f2f1e9", 0.2));

  document.dispatchEvent(new CustomEvent("wayfarer:theme", {detail: {id: preference.id, colors}}));
  return {id: preference.id, colors};
}

export function setThemePreset(id) {
  const preset = THEME_PRESETS.find((entry) => entry.id === id) || THEME_PRESETS[0];
  return applyTheme(saveThemePreference({id: preset.id, colors: preset.colors}));
}

export function setCustomTheme(colors) {
  return applyTheme(saveThemePreference({id: "custom", colors: normalizeColors(colors)}));
}
