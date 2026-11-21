import {diceTerms, makeActor, modifier} from "./combat.mjs";
import {matchSpell, matchWeapon, monsterRecord, readArchive, ruleKey} from "./rules-library.mjs";

const types = {S:"slashing", P:"piercing", B:"bludgeoning"};
const damageTypes = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
const abilities = ["str","dex","con","int","wis","cha"];

function *walk(entry) {
  if (Array.isArray(entry)) {
    for (const value of entry) yield *walk(value);
  } else if (entry && typeof entry === "object") {
    yield entry;
    for (const value of Object.values(entry)) yield *walk(value);
  }
}

export async function moduleMaps(id) {
  const archive = await readArchive("adventure/adventure-" + id.toLowerCase() + ".json");
  const chapters = archive?.data ?? archive?.adventureData?.find((entry) => entry.id.toLowerCase() === id.toLowerCase())?.data;
  if (!chapters) return [];
  const maps = [];
  const seen = new Set();
  for (const chapter of chapters) {
    const nodes = [...walk(chapter)];
    const entries = new Map(nodes.filter((entry) => entry.id && !entry.href).map((entry) => [entry.id, entry]));
    const images = nodes.filter((entry) => entry.type === "image" && ["map","mapPlayer"].includes(entry.imageType));
    for (const image of images) {
      if (image.grid?.type !== "square" || !image.grid.size || !image.width || !image.height) continue;
      const {width, height, grid} = image;
      const size = grid.size / (grid.scale || 1);
      const x = (grid.offsetX || 0) % size;
      const y = (grid.offsetY || 0) % size;
      const offsetX = x > 0 ? x - size : x;
      const offsetY = y > 0 ? y - size : y;
      const parent = image.mapParent?.autoScale ? images.find((entry) => entry.id === image.mapParent.id) : null;
      const baseRegions = image.mapRegions ?? parent?.mapRegions ?? [];
      const regions = baseRegions.map((region) => ({
        id:region.area,
        entry:entries.get(region.area),
        points:parent && !image.mapRegions
          ? region.points.map(([x,y]) => [x * width / parent.width, y * height / parent.height])
          : region.points,
      })).filter((region) => region.points?.length >= 3);
      const key = image.href?.path ?? image.id ?? image.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      maps.push({
        key, module:id, id:image.id ?? parent?.id, width, height, size, offsetX, offsetY,
        cols:Math.ceil((width-offsetX)/size), rows:Math.ceil((height-offsetY)/size), regions,
        title:image.title === "Player Version" && parent?.title ? parent.title + " (Player)" : image.title ?? key,
        caption:chapter.name ?? "", asset:image.href?.path,
      });
    }
  }
  return maps.filter((map) => map.cols * map.rows <= 90000);
}

const pilotRooms = {
  "01b":[],
  "01e":[["Goblin",2]],
  "021":[["Wolf",3]],
  "025":[],
  "029":[["Goblin",1]],
  "02f":[["Goblin",5],["Goblin",1,"Yeemik",12]],
  "034":[["Goblin",3]],
  "037":[["Bugbear",1,"Klarg"],["Wolf",1,"Ripper"],["Goblin",2]],
};

export const roomNotes = {
  "021":"The wolves start chained. Load them when combat begins.",
  "025":"The passage’s hazards are resolved manually.",
  "029":"The lookout can raise the alarm. Flood triggers are resolved manually.",
  "02f":"The captive is present in the room entry. Add him as a neutral token if needed.",
  "034":"A goblin can flee to warn Klarg. Move that token manually if it happens.",
};

export function roomRoster(map, region) {
  if (map.module === "LMoP" && map.id === "1ab" && region.id in pilotRooms) {
    return pilotRooms[region.id].map(([name, count, nickname, hp]) => ({name, count, nickname, hp, source:"MM"}));
  }
  const choices = new Map();
  const gather = function* (entry) {
    if (typeof entry === "string") {
      yield *entry.matchAll(/\{@creature\s+([^|}]+)(?:\|([^|}]*))?(?:\|[^}]*)?\}/gi);
    } else if (Array.isArray(entry)) {
      for (const value of entry) yield *gather(value);
    } else if (entry && typeof entry === "object") {
      for (const value of [entry.entries, entry.entry, entry.items]) yield *gather(value);
    }
  };
  for (const [,name, tagSource] of gather(region.entry?.entries)) {
    const source = tagSource || "MM";
    choices.set(ruleKey(name) + "|" + source.toLowerCase(), {name, source, count:1});
  }
  return [...choices.values()];
}

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length-1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside = !inside;
  }
  return inside;
}

export function cellCenter(map, cell) {
  return [map.offsetX + (cell.x + 0.5) * map.size, map.offsetY + (cell.y + 0.5) * map.size];
}

export function regionAt(map, x, y) {
  return map.regions.find((region) => pointInPolygon(x,y,region.points));
}

export function regionCells(map, region) {
  const xs = region.points.map(([x]) => x);
  const ys = region.points.map(([,y]) => y);
  const toColumn = (x) => Math.floor((x - map.offsetX) / map.size);
  const toRow = (y) => Math.floor((y - map.offsetY) / map.size);
  const cells = [];
  for (let y = Math.max(0,toRow(Math.min(...ys))); y <= Math.min(map.rows-1,toRow(Math.max(...ys))); y++) {
    for (let x = Math.max(0,toColumn(Math.min(...xs))); x <= Math.min(map.cols-1,toColumn(Math.max(...xs))); x++) {
      if (pointInPolygon(...cellCenter(map,{x,y}),region.points)) cells.push({x,y});
    }
  }
  const centerX = xs.reduce((sum, x) => sum+x,0)/xs.length;
  const centerY = ys.reduce((sum, y) => sum+y,0)/ys.length;
  const distance = (cell) => {
    const [x,y] = cellCenter(map, cell);
    return (x-centerX)**2+(y-centerY)**2;
  };
  return cells.sort((a,b) => distance(a)-distance(b));
}

function attackFromSheet(item) {
  const name = item.name;
  const bonus = typeof item.bonus === "number" ? item.bonus :
    /^[+-]?\d+$/.test(String(item.bonus ?? "")) ? Number(item.bonus) : null;
  const weapon = matchWeapon(name);
  const range = weapon?.range?.split("/").map(Number) ?? [];
  const suffix = String(item.damage || "").match(new RegExp("\\s+(" + damageTypes + ")$", "i"));
  const damage = suffix ? item.damage.slice(0, suffix.index) : item.damage;
  const result = {name, bonus, damage, type:suffix?.[1]?.toLowerCase() ?? (diceTerms(damage) ? types[weapon?.dmgType] : undefined),
    reach:weapon?.property?.includes("R") ? 10 : 5};
  if (weapon?.type === "R") {
    result.normalRange = range[0];
    result.longRange = range[1];
  }
  if (weapon?.property?.includes("T") && range[0]) {
    result.thrown = {normalRange:range[0], longRange:range[1]};
  }
  return result;
}

function healingItems(items) {
  const strengths = {
    "potion of healing":"2d4+2", "healing potion":"2d4+2",
    "potion of greater healing":"4d4+4", "greater healing potion":"4d4+4",
    "potion of superior healing":"8d4+8", "superior healing potion":"8d4+8",
    "potion of supreme healing":"10d4+20", "supreme healing potion":"10d4+20",
  };
  return items.flatMap(({name, quantity}) => {
    const override = /^healing potions?\s*\(([^)]+)\)$/i.exec(name)?.[1];
    const formula = override && diceTerms(override) ? override : strengths[ruleKey(name)];
    return formula && quantity > 0 ? [{name, quantity, formula}] : [];
  });
}

export function partyActor(character) {
  const speed = /^\d+(?:\s*ft\.?)?$/i.test(character.speed) ? Number.parseInt(character.speed,10) : null;
  if (!Number.isFinite(character.maxHp) || !Number.isFinite(character.ac) || speed == null) {
    throw new Error(character.name + " needs maximum HP, AC, and walking speed in the character sheet.");
  }
  const spells = character.spells.filter((spell) => spell.prepared).map(({name}) => matchSpell(name)).filter(Boolean);
  const scores = Object.fromEntries(character.abilities.map(({abbr, score, modifier:mod}) => [abbr.toLowerCase(),mod ?? modifier(score)]));
  const saves = Object.fromEntries(character.abilities.map(({abbr, save}) => [abbr.toLowerCase(),save]));
  const abilityText = String(character.spellcastingAbility ?? "").slice(0,3).toLowerCase();
  const spellAbility = typeof character.spellcastingAbility === "number" ? character.spellcastingAbility :
    scores[abilityText] ?? (Number.isFinite(character.spellDC) && Number.isFinite(character.proficiency)
      ? character.spellDC - 8 - character.proficiency : null);
  return makeActor({
    id:"party:" + character.id, side:"party", resolveDeath:true, name:character.name, ac:character.ac,
    hp:character.hp ?? character.maxHp, maxHp:character.maxHp, tempHp:character.tempHp ?? 0,
    initiative:character.initiative ?? scores.dex ?? 0, dex:character.abilities[1]?.score, ability:scores, saves,
    speed, attacks:character.attacks.map(attackFromSheet), potions:healingItems(character.items),
    spells:[...new Map(spells.map((spell) => [ruleKey(spell.name),
      {name:spell.name, key:ruleKey(spell.name), edition:spell.edition, level:spell.level}])).values()],
    slots:{...Object.fromEntries(spells.filter((spell) => spell.level).map((spell) =>
      [spell.level,{current:null,maximum:null}])), ...structuredClone(character.spellSlots ?? {})},
    spellAbility, spellDC:character.spellDC, spellAttack:character.spellAttack, level:character.level,
  });
}

function monsterAttack(action) {
  const body = action.entries?.filter((entry) => typeof entry === "string").join(" ") ?? "";
  const bonus = body.match(/\{@hit ([+-]?\d+)\}/)?.[1];
  if (bonus == null) return [];
  const damages = [...body.matchAll(new RegExp("\\{@damage ([^}]+)\\}\\)?\\s+(" + damageTypes + ") damage", "gi"))];
  if (!damages.length || !diceTerms(damages[0][1])) return [];
  const reach = Number(body.match(/reach (\d+) ft/i)?.[1]) || 5;
  const range = body.match(/range (\d+)(?:\/(\d+))? ft/i);
  const actionType = body.match(/\{@atk ([^}]+)/)?.[1] ?? "";
  const proneDC = action.name === "Bite" && /knocked prone/i.test(body) ? Number(body.match(/\{@dc (\d+)\}/)?.[1]) || null : null;
  const [first, alternate] = damages;
  const base = {name:action.name, bonus:Number(bonus), damage:first[1], type:first[2], reach, proneDC};
  const ranged = range ? {normalRange:Number(range[1]), longRange:Number(range[2] || range[1])} : null;
  if (ranged && actionType.includes("m") && actionType.includes("r")) {
    return [base, {...base, ...ranged, name:action.name + " (thrown)", damage:alternate?.[1] ?? first[1]}];
  }
  if (ranged && !actionType.includes("m")) return [{...base, ...ranged}];
  return [base];
}

export async function creatureActor({name, source, nickname, hp}) {
  const data = await monsterRecord(name, source);
  if (!data || !data.hp?.average || !data.ac?.[0]) throw new Error("A full stat block is unavailable for " + name + " (" + source + ").");
  const baseAC = data.ac[0];
  const maxHp = hp ?? data.hp.average;
  const speed = data.speed?.walk;
  return makeActor({
    name:nickname || data.name, ac:typeof baseAC === "number" ? baseAC : baseAC.ac,
    hp:maxHp, maxHp, speed:typeof speed === "number" ? speed : speed?.number ?? 0,
    dex:data.dex, initiative:modifier(data.dex) ?? 0, level:null,
    ability:Object.fromEntries(abilities.map((key) => [key,modifier(data[key])])),
    saves:Object.fromEntries(Object.entries(data.save ?? {}).map(([key,value]) => [key,Number(value)])),
    creatureType:typeof data.type === "string" ? data.type : data.type?.type,
    packTactics:data.trait?.some((trait) => trait.name === "Pack Tactics"),
    nimbleEscape:data.trait?.some((trait) => trait.name === "Nimble Escape"),
    attacks:data.action?.flatMap(monsterAttack) ?? [],
    resist:data.resist, immune:data.immune, vulnerable:data.vulnerable,
  });
}

const rect = (x,y,w,h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
export const trainingMap = {
  module:"training", key:"wayfarer-yard", title:"Wayfarer practice yard", width:1050, height:630, size:70,
  cols:15, rows:9, offsetX:0, offsetY:0,
  regions:[
    {id:"entry",entry:{name:"Entry gate", entries:["A field for learning movement, reach, and initiative."]},points:rect(70,70,350,490)},
    {id:"yard",entry:{name:"Practice ring", entries:["Take turns controlling each side. Use the terrain tools to mark barriers and difficult squares."]},points:rect(420,70,560,490)},
  ],
};

export function trainingActors() {
  return [
    makeActor({name:"Rowan", side:"party", resolveDeath:true, hp:21, maxHp:21, ac:16, initiative:2, dex:14, x:3,y:4,
      attacks:[{name:"Longsword", bonus:4, damage:"1d8+2", type:"slashing", reach:5}]}),
    makeActor({name:"Practice guard", hp:11, maxHp:11, ac:13, initiative:1, dex:12, x:8,y:4,
      attacks:[{name:"Spear", bonus:3, damage:"1d6+1", type:"piercing", reach:5,
        thrown:{normalRange:20,longRange:60}}]}),
  ];
}
