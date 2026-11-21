import {cellAt, cellCenter, gridGeometry, legacyGeometry, sourceGrid, validGeometry} from "./map-grid.mjs";
import {diceTerms, makeActor, modifier} from "./combat.mjs";
import {enrichCharacter} from "./character-rules.mjs";
import {bestiaryTokenPath, matchSpell, matchWeapon, monsterRecord, readArchive, ruleKey, spellKey} from "./rules-library.mjs";

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
      if (grid.units && !["ft","feet","foot"].includes(grid.units.toLowerCase())) continue;
      const source = sourceGrid(grid);
      const geometry = gridGeometry({width,height,sourceGrid:source});
      if (!validGeometry(geometry)) continue;
      const parent = image.mapParent?.autoScale ? images.find((entry) => entry.id === image.mapParent.id) : null;
      const baseRegions = image.mapRegions ?? parent?.mapRegions ?? [];
      const instances = new Map();
      const regions = baseRegions.map((region) => {
        const occurrence = (instances.get(region.area) ?? 0) + 1;
        instances.set(region.area,occurrence);
        return {
          id:region.area, key:occurrence === 1 ? region.area : region.area + ":" + occurrence,
          entry:entries.get(region.area),
          points:parent && !image.mapRegions
            ? region.points.map(([x,y]) => [x * width / parent.width, y * height / parent.height])
            : region.points,
        };
      }).filter((region) => region.points?.length >= 3);
      const key = image.href?.path ?? image.id ?? image.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      maps.push({
        key, module:id, id:image.id ?? parent?.id, width, height, regions,
        sourceGrid:source, legacyGrid:legacyGeometry(grid,width,height), ...geometry,
        title:image.title === "Player Version" && parent?.title ? parent.title + " (Player)" : image.title ?? key,
        caption:chapter.name ?? "", asset:image.href?.path, artist:image.credit,
      });
    }
  }
  return maps;
}

const pilotRooms = {
  "01b":[],
  "01e":[["Goblin",2]],
  "021":[["Wolf",3,null,null,"MM","neutral"]],
  "025":[],
  "029":[["Goblin",1]],
  "02f":[["Goblin",5],["Goblin",1,"Yeemik",12],["Sildar Hallwinter",1,null,null,"LMoP","neutral",1,true]],
  "034":[["Goblin",3]],
  "037":[["Bugbear",1,"Klarg"],["Wolf",1,"Ripper"],["Goblin",2]],
};

export const roomNotes = {
  "021":"The wolves start chained. Set them hostile when they can attack.",
  "025":"The passage’s hazards are resolved manually.",
  "029":"The lookout can raise the alarm. Flood triggers are resolved manually.",
  "02f":"Sildar starts bound, unarmed, and at 1 hit point.",
  "034":"A goblin can flee to warn Klarg. Move that token manually if it happens.",
};

export function authoredRoster(map, region) {
  if (map.module !== "LMoP" || map.id !== "1ab" || !(region.id in pilotRooms)) return null;
  return pilotRooms[region.id].map(([name,count,nickname,hp,source="MM",side="hostile",currentHp,disarmed]) =>
    ({name,count,nickname,hp,source,side,currentHp,disarmed}));
}

export function roomRoster(map, region) {
  const authored = authoredRoster(map,region);
  if (authored) return authored;
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

export {cellCenter};

export function regionAt(map, x, y) {
  return map.regions.find((region) => pointInPolygon(x,y,region.points));
}

export function regionCells(map, region) {
  const xs = region.points.map(([x]) => x);
  const ys = region.points.map(([,y]) => y);
  const first = cellAt(map,Math.min(...xs),Math.min(...ys));
  const last = cellAt(map,Math.max(...xs),Math.max(...ys));
  const cells = [];
  for (let y = Math.max(0,first.y); y <= Math.min(map.rows-1,last.y); y++) {
    for (let x = Math.max(0,first.x); x <= Math.min(map.cols-1,last.x); x++) {
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

export function partyActor(record) {
  const character = enrichCharacter(record);
  const speed = /^\d+(?:\s*ft\.?)?$/i.test(character.speed) ? Number.parseInt(character.speed,10) : null;
  if (!Number.isFinite(character.maxHp) || !Number.isFinite(character.ac) || speed == null) {
    throw new Error(character.name + " needs maximum HP, AC, and walking speed in the character sheet.");
  }
  const spells = character.spells.map(({name,level,prepared}) => {
    const spell = matchSpell(name);
    const note = spell && ruleKey(name) !== ruleKey(spell.name) ? name : "";
    const customUse = !spell || /without rolling|no spell slot|charges|unlimited|on snakes|infinite cast/i.test(note);
    return {name:spell?.name ?? name.split(" (")[0], key:ruleKey(spell?.name ?? name),
      edition:spell?.edition, level:spell?.level ?? level, note, customUse, prepared,
      reference:spell ? spellKey(spell) : "", timing:spell?.time?.[0]?.unit};
  });
  const scores = Object.fromEntries(character.abilities.map(({abbr, score, modifier:mod}) => [abbr.toLowerCase(),mod ?? modifier(score)]));
  const saves = Object.fromEntries(character.abilities.map(({abbr, save}) => [abbr.toLowerCase(),save]));
  const abilityText = String(character.spellcastingAbility ?? "").slice(0,3).toLowerCase();
  const spellAbility = typeof character.spellcastingAbility === "number" ? character.spellcastingAbility :
    scores[abilityText] ?? (Number.isFinite(character.spellDC) && Number.isFinite(character.proficiency)
      ? character.spellDC - 8 - character.proficiency : null);
  return makeActor({
    id:"party:" + character.id, side:"party", resolveDeath:true, name:character.name, ac:character.ac, tokenImage:character.tokenImage,
    hp:character.hp ?? character.maxHp, maxHp:character.maxHp, tempHp:character.tempHp ?? 0,
    initiative:character.initiative ?? scores.dex ?? 0, dex:character.abilities[1]?.score, ability:scores, saves,
    speed, darkvision:character.rulesDetails.darkvision, attacks:character.attacks.map(attackFromSheet), potions:healingItems(character.items),resist:character.resistances,
    spells:[...new Map(spells.map((spell) => [spell.key,spell])).values()],
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

export async function creatureActor({name, source, nickname, hp, side, currentHp, disarmed, named}) {
  const data = await monsterRecord(name, source);
  if (!data || !data.hp?.average || !data.ac?.[0]) throw new Error("A full stat block is unavailable for " + name + " (" + source + ").");
  const baseAC = data.ac[0];
  const maxHp = hp ?? data.hp.average;
  const speed = data.speed?.walk;
  const tokenArt = data.tokenHref?.type === "internal" ? data.tokenHref.path :
    data.hasToken || data.token ? bestiaryTokenPath(data.token ?? data) : null;
  return makeActor({
    name:nickname || data.name, ac:typeof baseAC === "number" ? baseAC : baseAC.ac,
    hp:currentHp ?? maxHp, maxHp,
    side:side ?? (named && data.isNpc ? "neutral" : "hostile"),
    statName:data.name, source:data.source, tokenArt,
    speed:typeof speed === "number" ? speed : speed?.number ?? 0,
    dex:data.dex, initiative:modifier(data.dex) ?? 0, level:null,
    ability:Object.fromEntries(abilities.map((key) => [key,modifier(data[key])])),
    saves:Object.fromEntries(Object.entries(data.save ?? {}).map(([key,value]) => [key,Number(value)])),
    creatureType:typeof data.type === "string" ? data.type : data.type?.type,
    packTactics:data.trait?.some((trait) => trait.name === "Pack Tactics"),
    nimbleEscape:data.trait?.some((trait) => trait.name === "Nimble Escape"),
    attacks:disarmed ? [] : data.action?.flatMap(monsterAttack) ?? [],
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
      statName:"Guard",source:"MM",tokenArt:bestiaryTokenPath({name:"Guard",source:"MM"}),
      attacks:[{name:"Spear", bonus:3, damage:"1d6+1", type:"piercing", reach:5,
        thrown:{normalRange:20,longRange:60}}]}),
  ];
}
