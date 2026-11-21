import {keyAt, occupies, placeToken} from "./combat.mjs";
import {authoredRoster, creatureActor, regionAt, regionCells, cellCenter} from "./encounters.mjs";
import {mapFloor} from "./map-walls.mjs";
import {automaticRoom, startingCount} from "./scene-data.mjs";
import {ruleKey} from "./rules-library.mjs";

export const areaKey = (region) => region?.key ?? region?.id;

export async function rosterTokens(record, random) {
  const count = startingCount(record,random);
  if (!count) return [];
  const model = await creatureActor(record);
  return Array.from({length:count}, (_, index) => ({
    ...structuredClone(model), id:globalThis.crypto.randomUUID(),
    name:count>1 ? model.name+" "+(index+1) : model.name,
    marker:count>1 ? String(index+1) : undefined,
  }));
}

function recordKey(record) {
  return ruleKey(record.name)+"|"+record.source.toLowerCase();
}

function alreadyPresent(battle, map, region, record) {
  const source = record.source.toLowerCase();
  const names = [ruleKey(record.name),ruleKey(record.nickname || record.name)];
  return battle.actors.filter((actor) => {
    if (actor.side==="party") return false;
    let existingRoom = actor.origin;
    if (!existingRoom && occupies(actor)) existingRoom = areaKey(regionAt(map,...cellCenter(map,actor)));
    const actorName = ruleKey(actor.name.replace(/\s\d+$/, ""));
    return existingRoom === areaKey(region) && (!actor.source || actor.source.toLowerCase() === source) &&
      (record.nickname ? actorName === names[1] : names.includes(ruleKey(actor.statName ?? actorName)) &&
        (!actor.statName || actorName === names[0] || !actorName));
  }).length;
}

export async function populateScene(map, battle, random = Math.random) {
  if (battle.sceneReady || map.module === "training") return;
  const mappedIds = new Set(map.regions.map(({id}) => id));
  const facts = new Map();
  const plans = map.regions.map((region) => {
    if (!facts.has(region.id)) facts.set(region.id,automaticRoom(region,mappedIds));
    const result = facts.get(region.id);
    const first = areaKey(region) === region.id;
    const special = map.module === "LMoP" && map.id === "1ab" && region.id === "029"
      ? [{type:"hazard",name:"Flood",detail:"The lookout can signal the goblins at the twin pools to release a flood through the passage.",hidden:true}]
      : [];
    return {
      region,
      creatures:(authoredRoster(map,region) ?? result.creatures).filter((record) => first || record.perPolygon),
      markers:first ? [...result.markers,...special] : [],
    };
  });
  const prepared = [];
  const loads = new Map();
  for (const {creatures} of plans) {
    for (const record of creatures) {
      const key = recordKey(record);
      if (!loads.has(key)) loads.set(key,creatureActor({name:record.name,source:record.source,named:record.named}).catch(() => null));
    }
  }
  for (const plan of plans) {
    const markers = [...plan.markers];
    const actors = [];
    for (const record of plan.creatures) {
      const count = startingCount(record,random);
      const needed = count - alreadyPresent(battle,map,plan.region,record);
      if (needed<=0) continue;
      const base = await loads.get(recordKey(record));
      if (!base) {
        markers.push({type:"creature",name:record.nickname ?? record.name,
          detail:"Starting creature reference · "+record.source+(record.detail ? " · "+record.detail : ""),hidden:true});
        continue;
      }
      for (let index=count-needed; index<count; index++) {
        const actor = structuredClone(base);
        const nickname = record.nickname ?? base.statName ?? base.name;
        actor.id = "scene:"+areaKey(plan.region)+":"+recordKey(record)+":"+(record.nickname ?? "")+":"+index;
        actor.name = count>1 ? nickname+" "+(index+1) : nickname;
        actor.marker = count>1 ? String(index+1) : undefined;
        actor.origin = areaKey(plan.region);
        actor.side = record.side ?? base.side;
        actor.maxHp = record.hp ?? base.maxHp;
        actor.hp = record.currentHp ?? actor.maxHp;
        actor.attacks = record.disarmed ? [] : base.attacks;
        actors.push(actor);
      }
    }
    prepared.push({region:plan.region,actors,markers});
  }

  const occupied = new Set(battle.actors.filter(occupies).map(({x,y})=>keyAt(x,y)));
  const markerSquares = new Set();
  battle.markers ??= [];
  for (const {region,actors,markers} of prepared) {
    if (!actors.length && !markers.length) continue;
    const cells = regionCells(map,region).filter(({x,y}) => mapFloor(map,x,y) && battle.terrain[keyAt(x,y)]!=="wall");
    for (const actor of actors) {
      const cell = cells.find(({x,y}) => !occupied.has(keyAt(x,y)));
      if (!cell) {
        battle.unplacedScene ??= {};
        battle.unplacedScene[areaKey(region)] = (battle.unplacedScene[areaKey(region)] ?? 0) + 1;
        continue;
      }
      placeToken(battle,actor,cell.x,cell.y,map);
      occupied.add(keyAt(cell.x,cell.y));
      battle.actors.push(actor);
    }
    for (const [index,marker] of markers.entries()) {
      const cell = cells.find(({x,y}) => !occupied.has(keyAt(x,y)) && !markerSquares.has(keyAt(x,y))) ??
        cells.find(({x,y}) => !markerSquares.has(keyAt(x,y))) ?? cells[0];
      if (!cell) continue;
      markerSquares.add(keyAt(cell.x,cell.y));
      battle.markers.push({...marker,...cell,id:"marker:"+areaKey(region)+":"+index,origin:areaKey(region)});
    }
  }
  battle.sceneReady = true;
}
