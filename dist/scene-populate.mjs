import {actorCells} from './actor-space.mjs';
import {keyAt, occupies, placeToken, canStand} from "./combat.mjs";
import {authoredRoster, creatureActor, regionAt, regionCells, cellCenter} from "./encounters.mjs";
import {mapFloor} from "./map-walls.mjs";
import {automaticRoom, startingCount} from "./scene-data.mjs";
import {ruleKey} from "./rules-library.mjs";
import {authoredFeatureOverrides} from "./feature-overrides.mjs";
import {
  markerFromFeature,
  mergeFeatureLayers,
  normalizeFeature,
  stripSourceExcerpts,
} from "./room-features.mjs";

export const areaKey = (region) => region?.key ?? region?.id;

const compiledCache = new Map();

/** Load build-time compiled features for a module when present. */
export async function loadCompiledFeatures(moduleId) {
  const key = String(moduleId || "").toLowerCase();
  if (!key) return null;
  if (compiledCache.has(key)) return compiledCache.get(key);
  try {
    const response = await fetch(new URL(`./compiled-features/${key}.json`, import.meta.url));
    if (!response.ok) {
      compiledCache.set(key, null);
      return null;
    }
    const data = await response.json();
    compiledCache.set(key, data);
    return data;
  } catch {
    compiledCache.set(key, null);
    return null;
  }
}

function compiledForMap(bundle, map) {
  if (!bundle?.regions) return [];
  const mapId = map.id || "";
  const mapKey = map.key || "";
  const features = [];
  for (const [regionId, entry] of Object.entries(bundle.regions)) {
    for (const raw of entry.features ?? []) {
      const feature = normalizeFeature({ ...raw, regionId }, {
        moduleId: bundle.module || map.module,
        mapKey: mapId || mapKey,
        regionId,
      });
      // Skip features authored for a different map id (module|mapId|region|…).
      const parts = String(feature.id).split("|");
      if (mapId && parts.length >= 3 && parts[1] && parts[1] !== mapId && parts[1] !== mapKey) continue;
      features.push(feature);
    }
  }
  return stripSourceExcerpts(features);
}

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
  const compiledBundle = await loadCompiledFeatures(map.module);
  const compiled = compiledForMap(compiledBundle, map);
  const overrides = authoredFeatureOverrides(map.module, map);
  const plans = map.regions.map((region) => {
    if (!facts.has(region.id)) facts.set(region.id,automaticRoom(region,mappedIds));
    const result = facts.get(region.id);
    const first = areaKey(region) === region.id;
    const special = map.module === "LMoP" && map.id === "1ab" && region.id === "029"
      ? [{type:"hazard",name:"Flood",detail:"The lookout can signal the goblins at the twin pools to release a flood through the passage.",hidden:true}]
      : [];
    const baseline = (result.features ?? []).map((feature) => normalizeFeature(feature, {
      moduleId: map.module,
      mapKey: map.id || map.key,
      regionId: areaKey(region),
    }));
    return {
      region,
      creatures:(authoredRoster(map,region) ?? result.creatures).filter((record) => first || record.perPolygon),
      markers:first ? [...result.markers,...special] : [],
      features: first ? baseline : [],
    };
  });

  const baselineFeatures = plans.flatMap((plan) => plan.features);
  const merged = mergeFeatureLayers({ baseline: baselineFeatures, compiled, overrides });
  const featuresByRegion = new Map();
  for (const feature of merged) {
    const list = featuresByRegion.get(feature.regionId) ?? [];
    list.push(feature);
    featuresByRegion.set(feature.regionId, list);
  }

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
    prepared.push({
      region: plan.region,
      actors,
      markers,
      features: featuresByRegion.get(areaKey(plan.region)) ?? featuresByRegion.get(plan.region.id) ?? [],
    });
  }

  const occupied = new Set(battle.actors.filter(occupies).flatMap(a=>actorCells(a).map(c=>keyAt(c.x,c.y))));
  const markerSquares = new Set();
  battle.markers ??= [];
  battle.features ??= [];
  for (const {region,actors,markers,features} of prepared) {
    if (!actors.length && !markers.length && !features.length) continue;
    const cells = regionCells(map,region).filter(({x,y}) => mapFloor(map,x,y) && battle.terrain[keyAt(x,y)]!=="wall");
    for (const actor of actors) {
      const cell = cells.find(({x,y}) => canStand(battle,actor,x,y,map));
      if (!cell) {
        battle.unplacedScene ??= {};
        battle.unplacedScene[areaKey(region)] = (battle.unplacedScene[areaKey(region)] ?? 0) + 1;
        continue;
      }
      placeToken(battle,actor,cell.x,cell.y,map);
      for(const c of actorCells(actor)) occupied.add(keyAt(c.x,c.y));
      battle.actors.push(actor);
    }
    const placedFeatureIds = new Set();
    for (const [index, marker] of markers.entries()) {
      const cell = cells.find(({x,y}) => !occupied.has(keyAt(x,y)) && !markerSquares.has(keyAt(x,y))) ??
        cells.find(({x,y}) => !markerSquares.has(keyAt(x,y))) ?? cells[0];
      if (!cell) continue;
      markerSquares.add(keyAt(cell.x,cell.y));
      const id = "marker:"+areaKey(region)+":"+index;
      const linked = features.find((feature) =>
        feature.kind === (marker.type === "treasure" ? "treasure" : marker.type === "trap" ? "trap" : marker.type === "hazard" ? "hazard" : feature.kind)
        && ruleKey(feature.name) === ruleKey(marker.name)
        && !placedFeatureIds.has(feature.id));
      if (linked) {
        Object.assign(linked, cell);
        placedFeatureIds.add(linked.id);
        const board = markerFromFeature(linked);
        battle.markers.push({ ...marker, ...board, ...cell, id: linked.id, origin: areaKey(region) });
        battle.features.push(linked);
      } else {
        battle.markers.push({...marker,...cell,id,origin:areaKey(region)});
      }
    }
    for (const feature of features) {
      if (placedFeatureIds.has(feature.id)) continue;
      const anchored = feature.anchor && Number.isInteger(feature.anchor.x) && Number.isInteger(feature.anchor.y)
        ? { x: feature.anchor.x, y: feature.anchor.y }
        : (Number.isInteger(feature.x) ? { x: feature.x, y: feature.y } : null);
      const cell = (anchored && cells.some(({x,y}) => x === anchored.x && y === anchored.y) ? anchored : null)
        ?? cells.find(({x,y}) => !occupied.has(keyAt(x,y)) && !markerSquares.has(keyAt(x,y)))
        ?? cells.find(({x,y}) => !markerSquares.has(keyAt(x,y)))
        ?? cells[0];
      if (cell) {
        markerSquares.add(keyAt(cell.x, cell.y));
        Object.assign(feature, cell);
      }
      battle.features.push(feature);
      if (["treasure", "trap", "hazard", "object", "creature_hint"].includes(feature.kind) || feature.items || feature.lootCurrency) {
        battle.markers.push(markerFromFeature(feature));
      }
    }
  }
  battle.sceneReady = true;
}
