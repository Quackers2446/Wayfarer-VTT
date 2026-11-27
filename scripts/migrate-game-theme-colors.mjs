/**
 * One-shot: replace hardcoded Grove greens/golds in game.css with theme tokens.
 * Already applied — re-running on a migrated file is not supported.
 * Status hues (frost blue, psychic purple overlays, pure white/black) stay literal.
 */
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const path = fileURLToPath(new URL("../dist/game.css", import.meta.url));
let css = readFileSync(path, "utf8");

const TOKEN_BLOCK = `.game-screen {
  --game-ground: var(--theme-ground, #19271f);
  --game-panel: var(--theme-panel, #24352a);
  --game-line: var(--theme-line, #4b5b48);
  --game-text: var(--theme-text, #f4efdf);
  --game-muted: var(--theme-muted, #b9c8b6);
  --game-gold: var(--theme-accent, #edcf90);
  --game-top: color-mix(in srgb, var(--game-panel) 82%, #000 18%);
  --game-shade: color-mix(in srgb, var(--game-ground) 78%, #000 22%);
  --game-deep: color-mix(in srgb, var(--game-ground) 88%, #000 12%);
  --game-raised: color-mix(in srgb, var(--game-panel) 88%, var(--game-text) 6%);
  --game-raised-2: color-mix(in srgb, var(--game-panel) 72%, var(--game-text) 12%);
  --game-raised-3: color-mix(in srgb, var(--game-panel) 58%, var(--game-text) 18%);
  --game-button-bg: color-mix(in srgb, var(--game-panel) 72%, var(--game-text) 10%);
  --game-button-border: color-mix(in srgb, var(--game-line) 70%, var(--game-text) 12%);
  --game-button-hover: color-mix(in srgb, var(--game-panel) 55%, var(--game-text) 18%);
  --game-input-bg: color-mix(in srgb, var(--game-ground) 70%, var(--game-panel) 30%);
  --game-input-border: color-mix(in srgb, var(--game-line) 65%, var(--game-gold) 35%);
  --game-border-soft: color-mix(in srgb, var(--game-line) 55%, transparent);
  --game-gold-soft: color-mix(in srgb, var(--game-gold) 78%, var(--game-text) 22%);
  --game-gold-dim: color-mix(in srgb, var(--game-gold) 55%, var(--game-line) 45%);
  --game-gold-deep: color-mix(in srgb, var(--game-gold) 40%, var(--game-ground) 60%);
  --game-ink: color-mix(in srgb, var(--game-ground) 70%, #000 30%);
  --game-glass: color-mix(in srgb, var(--game-ground) 92%, #000 8%);
  --game-glass-strong: color-mix(in srgb, var(--game-ground) 88%, #000 12%);
  --game-glass-soft: color-mix(in srgb, var(--game-panel) 90%, #000 10%);
  --game-shadow: rgb(from var(--game-ground) r g b / 0.55);
  --game-shadow-deep: rgb(from var(--game-ground) r g b / 0.75);
  --game-ok: color-mix(in srgb, var(--game-muted) 35%, #7dce6a 65%);
  --game-ok-soft: color-mix(in srgb, var(--game-ok) 55%, var(--game-panel));
  --game-danger: #653d34;
  --game-danger-border: #9e654f;
  --game-danger-text: #fff1de;
  --game-danger-glow: #ffad7f;
  --game-warn: #66523b;
  --game-info: #3e5264;
  --game-magic: #604c66;
`;

/** Longest keys first so alpha suffixes win over base hex. */
const map = {
  // Alpha greens / shadows
  "#233a2ef2": "var(--game-glass-soft)",
  "#192c25f5": "var(--game-glass-strong)",
  "#182c24f5": "var(--game-glass-strong)",
  "#142b24f7": "var(--game-glass-strong)",
  "#172b25f2": "var(--game-glass)",
  "#172b24f2": "var(--game-glass)",
  "#102427f2": "var(--game-glass)",
  "#172b25ee": "var(--game-glass)",
  "#172c23e8": "var(--game-glass)",
  "#17251ee8": "var(--game-glass)",
  "#21372ee8": "var(--game-glass-soft)",
  "#080c08be": "var(--game-shadow-deep)",
  "#080c08d0": "var(--game-shadow-deep)",
  "#06150ebb": "var(--game-shadow-deep)",
  "#08150db3": "var(--game-shadow-deep)",
  "#1f252bb0": "var(--game-shadow)",
  "#152520b0": "var(--game-shadow)",
  "#08180d55": "var(--game-shadow)",
  "#08160d55": "var(--game-shadow)",
  "#06140d55": "var(--game-shadow)",
  "#4d625055": "var(--game-border-soft)",
  "#9aab8b66": "var(--game-border-soft)",
  "#9a885d66": "color-mix(in srgb, var(--game-gold-dim) 40%, transparent)",
  "#0b120e66": "var(--game-shadow)",
  "#102a2160": "var(--game-shadow)",
  "#07150c40": "color-mix(in srgb, var(--game-ground) 25%, transparent)",
  "#ebbd6b60": "color-mix(in srgb, var(--game-gold) 38%, transparent)",
  "#ebad6f44": "color-mix(in srgb, var(--game-gold) 27%, transparent)",
  "#f6dc9a22": "color-mix(in srgb, var(--game-gold) 13%, transparent)",
  "#c2ab7350": "color-mix(in srgb, var(--game-gold-dim) 31%, transparent)",
  "#8cbb9b40": "color-mix(in srgb, var(--game-ok) 25%, transparent)",
  "#79c78d44": "color-mix(in srgb, var(--game-ok) 27%, transparent)",
  "#b5b88d44": "color-mix(in srgb, var(--game-muted) 27%, transparent)",

  // Core palette
  "#19271f": "var(--game-ground)",
  "#17231d": "var(--game-ground)",
  "#17271f": "var(--game-ground)",
  "#172720": "var(--game-ground)",
  "#17241b": "var(--game-deep)",
  "#1d271c": "var(--game-deep)",
  "#1b2d24": "var(--game-deep)",
  "#1a2d26": "var(--game-deep)",
  "#1c3026": "var(--game-deep)",
  "#1f3327": "var(--game-deep)",
  "#20332a": "var(--game-deep)",
  "#20382f": "var(--game-raised)",
  "#162c24": "var(--game-deep)",
  "#13241d": "var(--game-shade)",
  "#141b16": "var(--game-ink)",
  "#101a14": "var(--game-shade)",
  "#0f1c18": "var(--game-shade)",
  "#242c25": "var(--game-deep)",
  "#2a332a": "var(--game-deep)",
  "#2b3024": "var(--game-deep)",

  "#24352a": "var(--game-panel)",
  "#243023": "var(--game-panel)",
  "#243830": "var(--game-panel)",
  "#253b32": "var(--game-panel)",
  "#26392d": "var(--game-panel)",
  "#263c2f": "var(--game-panel)",
  "#27392c": "var(--game-panel)",
  "#273329": "var(--game-panel)",
  "#23382b": "var(--game-panel)",
  "#192c25": "var(--game-panel)",
  "#2a4334": "var(--game-raised)",
  "#2a3f31": "var(--game-raised)",
  "#304437": "var(--game-raised)",
  "#324c38": "var(--game-raised)",
  "#345447": "var(--game-raised-2)",
  "#3a4a3d": "var(--game-raised)",
  "#3a5241": "var(--game-raised-2)",
  "#3c5c48": "var(--game-raised-2)",
  "#3d4b3e": "var(--game-raised)",
  "#3d5040": "var(--game-raised)",
  "#334332": "var(--game-raised)",
  "#405443": "var(--game-raised-2)",
  "#405c3f": "var(--game-raised-2)",
  "#415540": "var(--game-raised-2)",
  "#475047": "var(--game-raised-2)",
  "#3f6b4a": "var(--game-raised-3)",
  "#326446": "var(--game-raised-3)",
  "#386860": "var(--game-raised-3)",
  "#1e3930": "var(--game-raised)",
  "#173832": "var(--game-raised)",
  "#1e4a42": "var(--game-raised-2)",

  "#4b5b48": "var(--game-line)",
  "#4f634e": "var(--game-line)",
  "#50634e": "var(--game-line)",
  "#52684f": "var(--game-line)",
  "#526044": "var(--game-line)",
  "#53614a": "var(--game-line)",
  "#536450": "var(--game-line)",
  "#596b56": "var(--game-button-border)",
  "#58735d": "var(--game-button-border)",
  "#6a8269": "var(--game-button-border)",
  "#6a7a66": "var(--game-line)",
  "#6a7568": "var(--game-line)",
  "#6d7e64": "var(--game-line)",
  "#647360": "var(--game-line)",
  "#627764": "var(--game-line)",
  "#718f72": "var(--game-button-border)",
  "#738064": "var(--game-line)",
  "#788570": "var(--game-line)",
  "#7c8f75": "var(--game-line)",
  "#7e8e82": "var(--game-muted)",
  "#727b59": "var(--game-line)",
  "#7b8768": "var(--game-line)",

  "#8a978a": "var(--game-muted)",
  "#93a085": "var(--game-muted)",
  "#93a093": "var(--game-muted)",
  "#9aa896": "var(--game-muted)",
  "#9bb08f": "var(--game-muted)",
  "#9fb39f": "var(--game-muted)",
  "#b9c8b6": "var(--game-muted)",
  "#b9ccaf": "var(--game-muted)",
  "#bac1af": "var(--game-muted)",
  "#bac4ac": "var(--game-muted)",
  "#bcc6b7": "var(--game-muted)",
  "#bdcdb8": "var(--game-muted)",
  "#becdb8": "var(--game-muted)",
  "#c3cbbf": "var(--game-muted)",
  "#c3d0ba": "var(--game-muted)",
  "#c4cabc": "var(--game-muted)",
  "#c5d3c2": "var(--game-muted)",
  "#c6d7c7": "var(--game-muted)",
  "#cedbc5": "var(--game-muted)",
  "#d4decd": "var(--game-muted)",
  "#dae6cf": "var(--game-muted)",
  "#e0efd6": "var(--game-muted)",
  "#e0e7d9": "var(--game-muted)",
  "#e5e9db": "var(--game-muted)",
  "#e6eddd": "var(--game-muted)",
  "#e8efd9": "var(--game-muted)",
  "#e8f5ef": "var(--game-muted)",
  "#e8f6ec": "var(--game-muted)",
  "#e9edd8": "var(--game-muted)",
  "#eaf0dc": "var(--game-muted)",
  "#ecedda": "var(--game-muted)",
  "#f0f4ea": "var(--game-muted)",
  "#f4f7ee": "var(--game-muted)",
  "#b7bdb0": "var(--game-muted)",

  "#f4efdf": "var(--game-text)",
  "#f8f2db": "var(--game-text)",
  "#fff3df": "var(--game-text)",
  "#fff2d6": "var(--game-text)",
  "#fff1d0": "var(--game-text)",
  "#eeeade": "var(--game-text)",
  "#e8e4d6": "var(--game-text)",
  "#e1e3d1": "var(--game-text)",
  "#e2dfd2": "var(--game-text)",
  "#dfdfd2": "var(--game-text)",
  "#deded2": "var(--game-text)",
  "#d8ddcf": "var(--game-text)",
  "#d8d2c4": "var(--game-text)",
  "#d7d2c4": "var(--game-text)",
  "#d7ceba": "var(--game-text)",
  "#f1eee3": "var(--game-text)",
  "#f4f1e8": "var(--game-text)",
  "#f7f4e9": "var(--game-text)",
  "#f7f5eb": "var(--game-text)",

  "#edcf90": "var(--game-gold)",
  "#ecd191": "var(--game-gold)",
  "#e1c890": "var(--game-gold)",
  "#e6ce96": "var(--game-gold)",
  "#d9bd82": "var(--game-gold)",
  "#d7c089": "var(--game-gold)",
  "#d6ba7d": "var(--game-gold)",
  "#cfbe91": "var(--game-gold-dim)",
  "#c3ab78": "var(--game-gold-dim)",
  "#c0a366": "var(--game-gold-dim)",
  "#b99c64": "var(--game-gold-dim)",
  "#b9a274": "var(--game-gold-dim)",
  "#b8a370": "var(--game-gold-dim)",
  "#b29a69": "var(--game-gold-dim)",
  "#ad966d": "var(--game-gold-dim)",
  "#a68b68": "var(--game-gold-dim)",
  "#a28d60": "var(--game-gold-dim)",
  "#a28d61": "var(--game-gold-dim)",
  "#9a885d": "var(--game-gold-dim)",
  "#8c815e": "var(--game-gold-dim)",
  "#8a6a3a": "var(--game-gold-deep)",
  "#736e4e": "var(--game-gold-deep)",
  "#73644c": "var(--game-gold-deep)",
  "#5c5037": "var(--game-gold-deep)",
  "#322a1b": "var(--game-ink)",
  "#bc995c": "var(--game-gold-dim)",
  "#c9a45a": "var(--game-gold-dim)",
  "#d6b56a": "var(--game-gold)",
  "#c5bc9c": "var(--game-gold-dim)",
  "#d7c7a4": "var(--game-gold-soft)",
  "#d7c79d": "var(--game-gold-soft)",

  "#f9e6bc": "var(--game-gold-soft)",
  "#f5dda8": "var(--game-gold-soft)",
  "#f4ddab": "var(--game-gold-soft)",
  "#f3daac": "var(--game-gold-soft)",
  "#f2dcae": "var(--game-gold-soft)",
  "#f2d9a7": "var(--game-gold-soft)",
  "#f2d9a1": "var(--game-gold-soft)",
  "#f1ddab": "var(--game-gold-soft)",
  "#f0d9a8": "var(--game-gold-soft)",
  "#efe0b4": "var(--game-gold-soft)",
  "#efd59b": "var(--game-gold-soft)",
  "#efd39e": "var(--game-gold-soft)",
  "#e9d9b4": "var(--game-gold-soft)",
  "#e8d3a4": "var(--game-gold-soft)",
  "#e8d3a7": "var(--game-gold-soft)",
  "#e5d2a5": "var(--game-gold-soft)",
  "#e2d4a9": "var(--game-gold-soft)",
  "#eadfbf": "var(--game-gold-soft)",
  "#ead8a7": "var(--game-gold-soft)",
  "#ead1a1": "var(--game-gold-soft)",
  "#ead199": "var(--game-gold-soft)",
  "#ffe0a0": "var(--game-gold-soft)",
  "#ffe3a4": "var(--game-gold-soft)",
  "#ffe4ad": "var(--game-gold-soft)",
  "#ffdf92": "var(--game-gold-soft)",
  "#ffdc88": "var(--game-gold-soft)",
  "#fff0bd": "var(--game-gold-soft)",
  "#fedda2": "var(--game-gold-soft)",
  "#f7dfad": "var(--game-gold-soft)",
  "#ebad6f": "var(--game-gold)",
  "#edb779": "var(--game-gold)",
  "#f1c49c": "var(--game-gold-soft)",

  // Soft success greens used as chrome accents
  "#b3dc82": "var(--game-ok)",
  "#b8cf88": "var(--game-ok)",
  "#a7f0bb": "var(--game-ok)",
  "#a4d4b3": "var(--game-ok-soft)",
  "#a9dfba": "var(--game-ok)",
  "#a5dbbb": "var(--game-ok)",
  "#9fd7a8": "var(--game-ok)",
  "#91c3ad": "var(--game-ok-soft)",
  "#8cbb9b": "var(--game-ok-soft)",
  "#8bc49b": "var(--game-ok-soft)",
  "#85dbb7": "var(--game-ok)",
  "#7bdec5": "var(--game-ok)",
  "#79c78d": "var(--game-ok)",
  "#78c7bd": "var(--game-ok)",
  "#c0dfb0": "var(--game-ok-soft)",
  "#b7f5c9": "var(--game-ok)",
  "#ddfbea": "var(--game-ok-soft)",
  "#e2f8eb": "var(--game-ok-soft)",
  "#9fdecf": "var(--game-ok)",
  "#648984": "var(--game-ok-soft)",

  // Combat / danger chrome
  "#653d34": "var(--game-danger)",
  "#603b34": "var(--game-danger)",
  "#70483c": "var(--game-danger)",
  "#9e654f": "var(--game-danger-border)",
  "#925e50": "var(--game-danger-border)",
  "#9c4932": "var(--game-danger-border)",
  "#fff1de": "var(--game-danger-text)",
  "#ffeee4": "var(--game-danger-text)",
  "#ffad7f": "var(--game-danger-glow)",
  "#ffd3b2": "var(--game-danger-glow)",
  "#ffb09c": "var(--game-danger-glow)",

  "#66523b": "var(--game-warn)",
  "#3e5264": "var(--game-info)",
  "#3b5662": "var(--game-info)",
  "#23313a": "var(--game-info)",
  "#253d40": "var(--game-info)",
  "#604c66": "var(--game-magic)",
  "#57506b": "var(--game-magic)",

  // Light paper leftovers inside game UI → theme text/panel mixes
  "#fbfaf4": "var(--game-text)",
  "#fdfcf7": "var(--game-text)",
  "#fffdf8": "var(--game-text)",
};

const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
let replaced = 0;
for (const [hex, token] of entries) {
  const re = new RegExp(hex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const next = css.replace(re, () => {
    replaced += 1;
    return token;
  });
  css = next;
}

// Re-assert the token block last so fallback hexes inside var() stay literal.
css = css.replace(/\.game-screen \{[\s\S]*?min-height: 100vh;/, `${TOKEN_BLOCK}  min-height: 100vh;`);

writeFileSync(path, css);
const left = [...css.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0].toLowerCase());
const counts = left.reduce((acc, hex) => (acc[hex] = (acc[hex] || 0) + 1, acc), {});
const leftover = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.log(`Replaced ${replaced} hex usages.`);
console.log(`Remaining distinct hexes: ${leftover.length}`);
console.log(leftover.slice(0, 50).map(([h, n]) => `${n}\t${h}`).join("\n"));
