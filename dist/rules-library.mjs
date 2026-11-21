import {escape} from "./format.mjs";

const archiveKey = "wayfarer-data-v1";
let archive = null;
let archiveSource = "";
let rules = {spells: [], weapons: []};
let rulesRequest;
let catalogIndex = new Map();
let spellOptions = [];
let weaponOptions = [];
let archiveRestore;
let archiveRevision = 0;
const opened = new Map();

export const archiveName = () => archiveSource;
export const hasArchive = () => archive !== null;

export function ruleKey(name) {
  return String(name ?? "").normalize("NFKD").toLowerCase().replace(/[’‘']/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function findByPrefix(records, label) {
  const query = ruleKey(label);
  return records.find(({key}) => query === key) ?? records.find(({key}) => query.startsWith(key + " "));
}

export function loadRules() {
  if (!rulesRequest) rulesRequest = fetch("rules.json").then((response) => {
    if (!response.ok) throw new Error("Rules index unavailable.");
    return response.json();
  }).then((data) => {
    rules = data;
    catalogIndex = new Map(rules.spells.map((spell) => [spellKey(spell), spell]));
    spellOptions = rules.spells.flatMap((spell) => {
      const names = [spell.name, ...(Array.isArray(spell.alias) ? spell.alias : []), spell.srdName].filter(Boolean);
      return names.map((name) => ({spell, key:ruleKey(name)}));
    }).sort((a, b) => b.key.length - a.key.length ||
      Number(b.spell.edition === "2014") - Number(a.spell.edition === "2014") ||
      Number(["PHB","XPHB"].includes(b.spell.source)) - Number(["PHB","XPHB"].includes(a.spell.source)));
    weaponOptions = rules.weapons.map((weapon) => ({key:ruleKey(weapon.name), weapon})).sort((a, b) => b.key.length - a.key.length);
    return data;
  });
  return rulesRequest;
}

export function matchSpell(label) {
  return findByPrefix(spellOptions, label)?.spell;
}

export function matchWeapon(label) {
  return findByPrefix(weaponOptions, label)?.weapon;
}

export function spellByKey(key) {
  return catalogIndex.get(key);
}

export function spellKey(spell) {
  return spell.source.toLowerCase() + "|" + ruleKey(spell.name);
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(archiveKey, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function savedArchive(value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", value ? "readwrite" : "readonly");
    const files = tx.objectStore("files");
    const request = value ? files.put(value, "archive") : files.get("archive");
    tx.oncomplete = () => {db.close(); resolve(request.result);};
    tx.onerror = tx.onabort = () => {db.close(); reject(tx.error);};
  });
}

async function parseArchive(blob) {
  const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
  const name = Object.keys(zip.files).find((path) => /(^|\/)data\/adventures\.json$/i.test(path));
  if (!name) throw new Error("Choose a 5etools ZIP that contains data/adventures.json.");
  return {zip, prefix:name.slice(0, -"adventures.json".length)};
}

function setArchive(parsed, name) {
  archive = parsed;
  archiveSource = name;
  opened.clear();
  document.dispatchEvent(new CustomEvent("wayfarer:archive"));
}

export function restoreArchive() {
  if (!archiveRestore) {
    const initialRevision = archiveRevision;
    archiveRestore = savedArchive().then(async (file) => {
      if (!file || initialRevision !== archiveRevision) return;
      const parsed = await parseArchive(file.blob);
      if (initialRevision === archiveRevision) setArchive(parsed, file.name);
    }).catch(() => {});
  }
  return archiveRestore;
}

export async function attachArchive(blob, name) {
  const revision = ++archiveRevision;
  const parsed = await parseArchive(blob);
  if (revision !== archiveRevision) return {saved:false};
  setArchive(parsed, name);
  const saved = await savedArchive({blob, name}).then(() => true, () => false);
  return {saved};
}

export function readArchive(path) {
  if (!archive) return Promise.resolve(null);
  if (!opened.has(path)) {
    const file = archive.zip.file(archive.prefix + path);
    opened.set(path, file ? file.async("string").then(JSON.parse) : Promise.resolve(null));
  }
  return opened.get(path);
}

export function mapImage(path) {
  if (!archive || !path) return Promise.resolve(null);
  const file = archive.zip.file(archive.prefix.slice(0,-"data/".length) + "img/" + path);
  return file?.async("blob") ?? Promise.resolve(null);
}

export async function hostedMapImage(path, signal) {
  const parts = typeof path === "string" ? path.split("/") : [];
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) return null;
  const encodedPath = parts.map(encodeURIComponent).join("/");
  const providers = [
    "https://cdn.5e.tools/2024/img/",
    "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/",
  ];
  for (const root of providers) {
    if (signal.aborted) break;
    try {
      const response = await fetch(root + encodedPath, {signal, credentials:"omit", referrerPolicy:"no-referrer"});
      if (response.ok && response.headers.get("Content-Type")?.startsWith("image/")) return await response.blob();
      await response.body?.cancel();
    } catch {
      // Try the next image host if a network request fails.
    }
  }
  return null;
}

async function sourcedRecord(kind, recordType, source, name, indexFile = "index.json") {
  const index = await readArchive(kind + "/" + indexFile);
  const code = Object.keys(index ?? {}).find((entry) => entry.toLowerCase() === source.toLowerCase());
  if (!code) return null;
  const content = await readArchive(kind + "/" + index[code]);
  return content?.[recordType]?.find((entry) => ruleKey(entry.name) === ruleKey(name)) ?? null;
}

export async function fullSpell(spell) {
  if (!archive) return spell;
  const entry = await sourcedRecord("spells", "spell", spell.source, spell.name);
  return entry ? {...spell, ...entry} : spell;
}

export async function monsterRecord(name, source = "MM") {
  return sourcedRecord("bestiary", "monster", source, name);
}

export function bestiaryTokenPath({name,source}) {
  const ascii = name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/Æ/g,"AE").replace(/æ/g,"ae").replace(/"/g,"");
  return "bestiary/tokens/"+source+"/"+ascii+".webp";
}

export function monsterFluff(name, source) {
  return sourcedRecord("bestiary","monsterFluff",source,name,"fluff-index.json");
}

export function markedText(value) {
  let current = String(value ?? "");
  let previous;
  do {
    previous = current;
    current = current.replace(/\{@(\w+)\s+([^{}]+)\}/g, (_, tag, body) => {
      const [primary, secondary, printed] = body.split("|");
      if (tag === "dc") return "DC " + primary;
      if (tag === "hit") return (primary.startsWith("-") ? "" : "+") + primary;
      if (tag === "atk" || tag === "atkr" || tag === "h") return "";
      if (tag === "recharge") return "Recharge " + primary;
      if (tag === "damage" || tag === "dice" || tag === "scaledice" || tag === "scaledamage") return primary;
      return printed || (["quickref","area","skill","variantrule"].includes(tag) ? primary : primary || secondary);
    });
  } while (previous !== current);
  return escape(current).replace(/\s+([.,;])/g, "$1");
}

export function formatEntries(entries) {
  if (typeof entries === "string" || typeof entries === "number") return "<p>" + markedText(entries) + "</p>";
  if (Array.isArray(entries)) return entries.map(formatEntries).join("");
  if (!entries || typeof entries !== "object") return "";
  const title = entries.name ? "<h3>" + markedText(entries.name) + "</h3>" : "";
  if (entries.type === "list") return title + "<ul>" + (entries.items ?? []).map((item) =>
    "<li>" + formatEntries(item) + "</li>").join("") + "</ul>";
  if (entries.type === "table" && entries.rows) {
    return title + '<div class="table-frame"><table><thead><tr>' +
      (entries.colLabels ?? []).map((cell) => "<th>" + markedText(cell) + "</th>").join("") +
      "</tr></thead><tbody>" + entries.rows.map((row) => "<tr>" +
      (Array.isArray(row) ? row : row.row ?? []).map((cell) => "<td>" +
        (typeof cell === "object" ? formatEntries(cell.entry ?? cell.entries) : markedText(cell)) + "</td>").join("") +
      "</tr>").join("") + "</tbody></table></div>";
  }
  return title + formatEntries(entries.entry ?? entries.entries ?? entries.items);
}

export function spellFacts(spell) {
  const schools = {A:"Abjuration", C:"Conjuration", D:"Divination", E:"Enchantment", V:"Evocation",
    I:"Illusion", N:"Necromancy", T:"Transmutation"};
  const ranges = spell.range?.distance;
  const range = ranges?.amount ? ranges.amount + " " + ranges.type : ranges?.type ?? spell.range?.type;
  return [
    ["Level", spell.level === 0 ? "Cantrip" : String(spell.level)],
    ["School", schools[spell.school]],
    ["Casting time", spell.time?.map(({number, unit, condition}) =>
      [number, unit, condition ? "(" + condition + ")" : ""].filter(Boolean).join(" ")).join(" or ")],
    ["Range", range ? range.charAt(0).toUpperCase() + range.slice(1) : ""],
    ["Components", ["v","s","m"].filter((key) => spell.components?.[key]).map((key) => key.toUpperCase()).join(", ")],
    ["Duration", spell.duration?.map(({type,duration,concentration}) => {
      if (type === "instant") return "Instantaneous";
      if (!duration) return type === "permanent" ? "Until dispelled" : type;
      const amount = duration.amount + " " + duration.type + (duration.amount === 1 ? "" : "s");
      return concentration ? "Concentration, up to " + amount : amount;
    }).join(" or ")],
  ].filter(([,value]) => value);
}
