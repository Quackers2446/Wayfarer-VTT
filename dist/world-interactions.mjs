import {automaticRoom} from './scene-data.mjs';
import {cellCenter, creatureActor, regionAt, regionCells} from './encounters.mjs';
import {mapFloor} from './map-walls.mjs';
import {actorIsUp,canTakeTurn,incapacitated,distanceFt,lineClear,canStand,log,spendObjectAction,rollDice,applyDamage,d20,armorClass,placeToken,keyAt} from './combat.mjs';
import {creatureSize,containsCell,actorCells} from './actor-space.mjs';
import {recordAction,withActionEvent} from './action-events.mjs';
import {FEATURE_STATES, featuresInRegion, setFeatureState, syncMarkerForFeature} from './room-features.mjs';
const areaKey = (region) => region?.key ?? region?.id;
const fail=message=>{throw Error(message);};
const potionFormula=name=>({'potion of healing':'2d4+2','healing potion':'2d4+2','potion of greater healing':'4d4+4','potion of superior healing':'8d4+8','potion of supreme healing':'10d4+20'})[name.toLowerCase()];
function awake(battle,actor){if(!actorIsUp(actor)||incapacitated(actor))fail('Choose a conscious character.');if(battle.movement||battle.classReaction)fail('Resolve the pending reaction first.');if(battle.round&&!canTakeTurn(battle,actor))fail('Wait for this character’s turn.');}
export function withinReach(battle,actor,object,map){return object && object.x!=null && object.y!=null && distanceFt(actor,object)<=5 && lineClear(battle,actor,object,map);}
export function syncRewardSheets(battle){for(const actor of battle.actors.filter(a=>a.side==='party')){const sheet=battle.sheets?.[actor.id];if(sheet){if(actor.items)sheet.items=structuredClone(actor.items);if(actor.currency)sheet.currency=structuredClone(actor.currency);if(actor.xp!=null)sheet.xp=actor.xp;}}}
export function lootContents(source){return {items:(source?.loot ?? source?.items ?? []).filter(item=>item.quantity>0),currency:Object.fromEntries(Object.entries(source?.lootCurrency ?? {}).filter(([,amount])=>amount>0))};}
export function takeLoot(battle,actor,source,map,index=null){
 awake(battle,actor);if(!source || source.side && !source.dead)fail('Loot is available on defeated creatures.');
 if(source.carriedBy && source.carriedBy!==actor.id)fail('Another character is carrying this body.');
 if(source.draggedBy && source.draggedBy!==actor.id)fail('Another character is dragging this body.');
 if(actor.dragging)fail('Drop the dragged body before looting with your hands.');
 if(!withinReach(battle,actor,source,map))fail('Move within 5 feet of the loot with a clear path.');
 if(source.hidden&&!source.revealed)fail('Discover this treasure before collecting it.');
 const contents=lootContents(source),items=index==null?contents.items:contents.items.filter(item=>(source.loot ?? source.items).indexOf(item)===index);
 const coins=index==null?contents.currency:{};if(!items.length&&!Object.keys(coins).length)fail('Nothing remains to take.');
 return withActionEvent(battle,actor,{action:'Loot '+source.name,kind:'loot',target:source.name},()=>{
  spendObjectAction(battle,actor,'loot');actor.items ??= [];
  for(const item of items){const key=(item.reference ?? item.name).toLowerCase(),existing=actor.items.find(entry=>(entry.reference ?? entry.name).toLowerCase()===key),quantity=item.quantity;if(existing)existing.quantity=(existing.quantity??1)+quantity;else actor.items.push({...item});
   const formula=item.formula ?? potionFormula(item.name);if(formula){actor.potions ??= [];const potion=actor.potions.find(p=>p.name.toLowerCase()===item.name.toLowerCase());if(potion)potion.quantity+=quantity;else actor.potions.push({name:item.name,formula,quantity});}
   item.quantity=0;
  }
  actor.currency ??= {};for(const [unit,amount] of Object.entries(coins)){actor.currency[unit]=(Number(actor.currency[unit])||0)+amount;source.lootCurrency[unit]=0;}
  source.looted=lootContents(source).items.length===0&&!Object.keys(lootContents(source).currency).length;
  actor.rewardsRevision=(actor.rewardsRevision??0)+1;syncRewardSheets(battle);
  log(battle,actor.name+' collects '+[...items.map(item=>item.name),...Object.entries(coins).map(([unit,n])=>n+' '+unit)].join(', ')+' from '+source.name+'.');
 });
}
export const bodyWeight=body=>Number.isFinite(body.weight)?Math.max(1,body.weight):({T:5,S:40,M:150,L:600,H:2400,G:10000})[creatureSize(body)];
export function carryingCapacity(actor){return Math.max(1,actor.strength ?? 10+2*(actor.ability?.str??0))*15*({T:.5,S:1,M:1,L:2,H:4,G:8})[creatureSize(actor)];}
export function carryBody(battle,actor,body,map){
 awake(battle,actor);if(!body || body.id===actor.id || !(body.dead||body.hp===0))fail('Choose a dead or unconscious creature.');
 if(body.carriedBy||body.draggedBy||actor.carrying||actor.dragging)fail('Only one character can carry or drag a body, and only one body at a time.');
 if(!withinReach(battle,actor,body,map))fail('Move within 5 feet of the body with a clear path.');
 const load=bodyWeight(body)+(actor.items??[]).reduce((n,item)=>n+(Number(item.weight)||0)*(Number(item.quantity)||0),0);
 if(load>carryingCapacity(actor))fail('This body is too heavy for your carrying capacity. Use Drag instead.');
 return withActionEvent(battle,actor,{action:'Pick up '+body.name,kind:'ability',target:body.name},()=>{spendObjectAction(battle,actor,'carry-body');actor.carrying=body.id;body.carriedBy=actor.id;body.x=actor.x;body.y=actor.y;log(battle,actor.name+' picks up '+body.name+'. Carrying a body halves movement speed.');});
}
/** Drag a dead/unconscious creature along the ground — no carrying-capacity check; hands stay occupied. */
export function dragBody(battle,actor,body,map){
 awake(battle,actor);if(!body || body.id===actor.id || !(body.dead||body.hp===0))fail('Choose a dead or unconscious creature.');
 if(body.carriedBy||body.draggedBy||actor.carrying||actor.dragging)fail('Only one character can carry or drag a body, and only one body at a time.');
 if(!withinReach(battle,actor,body,map))fail('Move within 5 feet of the body with a clear path.');
 return withActionEvent(battle,actor,{action:'Drag '+body.name,kind:'ability',target:body.name},()=>{
  // Leave the body on its square — it trails one step behind as you move.
  spendObjectAction(battle,actor,'drag-body');actor.dragging=body.id;body.draggedBy=actor.id;
  log(battle,actor.name+' starts dragging '+body.name+'. Dragging halves movement speed and occupies both hands.');
 });
}
const adjacentCells=(origin)=>[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]].map(([dx,dy])=>({x:origin.x+dx,y:origin.y+dy}));
export function dropBody(battle,actor,body,map){
 awake(battle,actor);if(!body || actor.dragging!==body.id || body.draggedBy!==actor.id)fail('Drag this body first.');
 const landing={...body,draggedBy:null,carriedBy:null};
 const trailed=body.x!=null && body.y!=null && (body.x!==actor.x || body.y!==actor.y) &&
  canStand(battle,landing,body.x,body.y,map) && lineClear(battle,actor,body,map);
 const destination=trailed ? {x:body.x,y:body.y}
  : adjacentCells(actor).find(cell=>canStand(battle,landing,cell.x,cell.y,map)&&lineClear(battle,actor,cell,map))
  ?? (canStand(battle,landing,actor.x,actor.y,map)?{x:actor.x,y:actor.y}:null);
 if(!destination)fail('No open square is available to drop the body.');
 return withActionEvent(battle,actor,{action:'Drop '+body.name,kind:'ability',target:body.name,targetActor:body.id},()=>{
  body.draggedBy=null;actor.dragging=null;body.x=destination.x;body.y=destination.y;
  log(battle,actor.name+' drops '+body.name+' at square '+(destination.x+1)+', '+(destination.y+1)+'.');
 });
}
export function placeBody(battle,actor,body,square,map,{thrown=false}={},random=Math.random){
 awake(battle,actor);if(!body || actor.carrying!==body.id || body.carriedBy!==actor.id)fail('Pick up this body first.');
 if(!Number.isInteger(square?.x)||!Number.isInteger(square?.y)||square.x<0||square.y<0||square.x>=map.cols||square.y>=map.rows)fail('Choose a square on the map.');
 if(distanceFt(actor,square)>(thrown?20:5)||!lineClear(battle,actor,square,map))fail(thrown?'Choose a clear throwing destination within 20 feet.':'Place the body within 5 feet with a clear path.');
 const landing={...body,carriedBy:null};
 const target=thrown && battle.actors.find(target=>target.id!==actor.id && target.id!==body.id && !target.dead && !target.carriedBy && !target.draggedBy && target.x!=null && containsCell(target,square.x,square.y));
 let destination=square;
 if(target){destination=adjacentCells(square).find(cell=>canStand(battle,landing,cell.x,cell.y,map)&&lineClear(battle,actor,cell,map));}
 if(!destination || !canStand(battle,landing,destination.x,destination.y,map))fail('The body needs an unoccupied, open landing space.');
 return withActionEvent(battle,actor,{action:(thrown?'Throw ':'Place ')+body.name,kind:thrown?'attack':'ability',target:target?.name ?? body.name,targetActor:target?.id ?? body.id},()=>{
  if(thrown)spendObjectAction(battle,actor,'throw-body');
  body.carriedBy=null;actor.carrying=null;const from={x:actor.x,y:actor.y};body.x=destination.x;body.y=destination.y;
  if(thrown && target){
    const attack=d20(actor.ability?.str??0,{random,label:'Improvised body throw'}),critical=attack.kept===20,hit=critical||attack.kept!==1&&attack.total>=armorClass(target);
    recordAction(battle,actor,{outcome:critical?'Critical hit':hit?'Hit':'Miss',roll:attack.kept,total:attack.total,type:'bludgeoning'});
    if(hit){const damage=rollDice('1d4'+((actor.ability?.str??0)>=0?'+':'')+(actor.ability?.str??0),{random,doubleDice:critical,label:'Body throw damage'});applyDamage(battle,target,damage.total,'bludgeoning',critical,random,actor);}
    log(battle,actor.name+' throws '+body.name+' at '+target.name+' — d20 '+attack.kept+' = '+attack.total+' vs AC '+armorClass(target)+': '+(critical?'Critical hit':hit?'Hit':'Miss')+'.');
  }
  if(thrown){const damage=rollDice('1d4' ,{random,label:'Thrown body impact'});applyDamage(battle,body,damage.total,'bludgeoning',false,random,actor);}
  log(battle,actor.name+(thrown?' throws ':' places ')+body.name+' at square '+(square.x+1)+', '+(square.y+1)+(thrown?'. The body takes impact damage.':'.'));
 });
}

export function initializeTreasure(battle,map){
 if(map && battle.worldLootVersion!==1){
  battle.markers ??= [];const mapped=new Set(map.regions.map(region=>region.id));
  for(const region of map.regions){if(region.key && region.key!==region.id)continue;const result=automaticRoom(region,mapped);
   for(const [index,marker] of result.markers.entries()){
    if(!marker.lootCurrency && marker.name!=='Valuables')continue;
    const origin=region.key ?? region.id;
    if(battle.markers.some(existing=>existing.origin===origin && existing.detail===marker.detail && (existing.lootCurrency || existing.name===marker.name)))continue;
    const cell=regionCells(map,region).find(cell=>mapFloor(map,cell.x,cell.y,battle));if(!cell)continue;
    battle.markers.push({...marker,...cell,origin,id:'loot:'+map.key+':'+origin+':'+index});
   }
  }
  battle.worldLootVersion=1;
 }
 for(const marker of battle.markers ?? []){
  if(marker.type!=='treasure'||marker.lootInitialized)continue;
  if(!marker.items && !marker.looted){marker.items=[];for(const match of String(marker.detail??'').matchAll(/\{@item\s+([^|}]+)(?:\|([^|}]*))?(?:\|([^}]+))?\}/gi)){
    const before=marker.detail.slice(Math.max(0,match.index-40),match.index),count=before.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*$/i)?.[1]?.toLowerCase();
    marker.items.push({name:match[3]||match[1],reference:(match[2]||'DMG').toLowerCase()+'|'+match[1].toLowerCase(),quantity:count?Number(count)||['','one','two','three','four','five','six','seven','eight','nine','ten'].indexOf(count):1});
  }}
  marker.lootInitialized=true;
 }
}
export function releaseRevivedBodies(battle,map){
 for(const body of battle.actors){
  if(!actorIsUp(body))continue;
  if(body.carriedBy){
   const carrier=battle.actors.find(actor=>actor.id===body.carriedBy);
   if(!carrier){body.carriedBy=null;continue;}
   const destination=adjacentCells(carrier).find(cell=>canStand(battle,{...body,carriedBy:null},cell.x,cell.y,map)&&lineClear(battle,carrier,cell,map));
   if(destination){body.carriedBy=null;carrier.carrying=null;body.x=destination.x;body.y=destination.y;}
  }
  if(body.draggedBy){
   const dragger=battle.actors.find(actor=>actor.id===body.draggedBy);
   if(!dragger){body.draggedBy=null;continue;}
   const destination=adjacentCells(dragger).find(cell=>canStand(battle,{...body,draggedBy:null},cell.x,cell.y,map)&&lineClear(battle,dragger,cell,map));
   if(destination){body.draggedBy=null;dragger.dragging=null;body.x=destination.x;body.y=destination.y;}
  }
 }
}

function skillModifier(actor, skill) {
  const key = String(skill || "investigation").toLowerCase();
  const bonus = actor.skillBonuses?.[key];
  if (Number.isFinite(bonus)) return bonus;
  const ability = ({athletics:"str",acrobatics:"dex",sleightofhand:"dex",stealth:"dex",arcana:"int",history:"int",investigation:"int",nature:"int",religion:"int",animalhandling:"wis",insight:"wis",medicine:"wis",perception:"wis",survival:"wis",deception:"cha",intimidation:"cha",performance:"cha",persuasion:"cha"})[key.replace(/\s+/g,"")];
  return actor.ability?.[ability] ?? 0;
}

function rollFeatureCheck(battle, actor, feature, random) {
  const skill = feature.check?.skill || "investigation";
  const dc = feature.check?.dc ?? 13;
  const modifier = skillModifier(actor, skill);
  const result = d20(modifier, { random, label: skill + " check" });
  log(battle, actor.name + " " + skill + " check (DC " + dc + ") — " + result.breakdown + " = " + result.total + ".");
  return { ...result, skill, dc, success: result.total >= dc };
}

async function applyFeatureOutcomes(battle, actor, feature, map, when, random) {
  const notes = [];
  for (const outcome of feature.outcomes ?? []) {
    if (outcome.on !== when) continue;
    if (outcome.effect === "reveal") {
      setFeatureState(feature, "revealed");
      syncMarkerForFeature(battle, feature);
      notes.push(feature.truthText || ("You discover " + feature.name + "."));
      recordFeatureDiscovery(battle, map, feature);
    } else if (outcome.effect === "log" && outcome.text) {
      notes.push(outcome.text);
    } else if (outcome.effect === "set_state") {
      const next = outcome.state || (FEATURE_STATES.includes(outcome.text) ? outcome.text : null);
      if (next) {
        setFeatureState(feature, next);
        syncMarkerForFeature(battle, feature);
      }
    } else if (outcome.effect === "loot") {
      setFeatureState(feature, "revealed");
      syncMarkerForFeature(battle, feature);
      notes.push("You can collect what you found.");
    } else if (outcome.effect === "spawn_creature" && outcome.creature) {
      await spawnFeatureCreature(battle, map, feature, outcome, random);
      notes.push((outcome.creature) + " is revealed!");
      setFeatureState(feature, "triggered");
      syncMarkerForFeature(battle, feature);
    } else if (outcome.effect === "unlock" && outcome.targetFeatureId) {
      const target = (battle.features ?? []).find((entry) => entry.id === outcome.targetFeatureId);
      if (target) {
        setFeatureState(target, "revealed");
        syncMarkerForFeature(battle, target);
        notes.push("That reveals " + target.name + ".");
      }
    }
  }
  if (!notes.length && when === "success") {
    setFeatureState(feature, "revealed");
    syncMarkerForFeature(battle, feature);
    notes.push(feature.truthText || ("You discover " + feature.name + "."));
    recordFeatureDiscovery(battle, map, feature);
  }
  for (const note of notes) log(battle, note);
  return notes;
}

export function recordFeatureDiscovery(battle, map, feature) {
  battle.story ??= { visited: [], rescued: false, discoveries: [] };
  battle.story.featureFinds ??= [];
  const key = (map?.key || "") + ":" + feature.id;
  if (battle.story.featureFinds.includes(key)) return;
  battle.story.featureFinds.push(key);
  battle.story.discoveries ??= [];
  battle.story.discoveries.push({
    key,
    map: map?.title,
    name: feature.name,
    entries: [feature.truthText || feature.surfaceText],
  });
}

async function spawnFeatureCreature(battle, map, feature, outcome, random) {
  const existing = battle.actors.some((actor) =>
    actor.origin === feature.regionId && ruleName(actor) === String(outcome.creature).toLowerCase());
  if (existing) return;
  let model;
  try {
    model = await creatureActor({ name: outcome.creature, source: outcome.source || "MM" });
  } catch {
    battle.markers ??= [];
    battle.markers.push({
      id: "spawn:" + feature.id,
      type: "creature",
      name: outcome.creature,
      detail: "Revealed by investigation",
      hidden: false,
      revealed: true,
      x: feature.x,
      y: feature.y,
      origin: feature.regionId,
    });
    return;
  }
  const actor = structuredClone(model);
  actor.id = "scene:feature:" + feature.id;
  actor.origin = feature.regionId;
  actor.side = "hostile";
  const cells = regionCells(map, map.regions.find((region) => areaKey(region) === feature.regionId || region.id === feature.regionId) || { points: [] })
    .filter((cell) => mapFloor(map, cell.x, cell.y) && battle.terrain[keyAt(cell.x, cell.y)] !== "wall");
  const occupied = new Set(battle.actors.filter((entry) => entry.x != null).flatMap((entry) => actorCells(entry).map((cell) => keyAt(cell.x, cell.y))));
  const cell = (Number.isInteger(feature.x) ? [{ x: feature.x, y: feature.y }, ...cells] : cells)
    .find((spot) => canStand(battle, actor, spot.x, spot.y, map) && !occupied.has(keyAt(spot.x, spot.y)));
  if (!cell) return;
  placeToken(battle, actor, cell.x, cell.y, map);
  battle.actors.push(actor);
}

function ruleName(actor) {
  return String(actor.statName || actor.name || "").replace(/\s\d+$/, "").toLowerCase();
}

/** Passive Perception hints when entering / searching a region. */
export function applyPassiveFeatureHints(battle, map, actor) {
  if (!actor || actor.side !== "party") return [];
  const region = regionAt(map, ...cellCenter(map, actor));
  if (!region) return [];
  const passive = Number.isFinite(actor.passivePerception) ? actor.passivePerception
    : 10 + skillModifier(actor, "perception");
  const hinted = [];
  for (const feature of featuresInRegion(battle, areaKey(region))) {
    if (feature.state !== "hidden") continue;
    const dc = feature.passivePerceptionDC ?? feature.check?.dc;
    if (!Number.isFinite(dc) || passive < dc) continue;
    setFeatureState(feature, "hinted");
    syncMarkerForFeature(battle, feature);
    hinted.push(feature);
  }
  return hinted;
}

/**
 * Search the character's current region. Always returns feedback, including a clear negative.
 */
export function searchRegion(battle, actor, map, random = Math.random) {
  awake(battle, actor);
  const region = regionAt(map, ...cellCenter(map, actor));
  if (!region) fail("Move into a mapped room before searching.");
  return withActionEvent(battle, actor, { action: "Search", kind: "check", target: region.entry?.name || region.id }, () => {
    spendObjectAction(battle, actor, "search");
    applyPassiveFeatureHints(battle, map, actor);
    const regionFeatures = featuresInRegion(battle, areaKey(region))
      .filter((feature) => feature.state === "hidden" || feature.state === "hinted");
    if (!regionFeatures.length) {
      log(battle, actor.name + " searches " + (region.entry?.name || "the area") + " and finds nothing of note.");
      return { found: [], empty: true };
    }
    const found = [];
    for (const feature of regionFeatures) {
      const check = rollFeatureCheck(battle, actor, feature, random);
      if (check.success) {
        found.push(feature);
        // Fire sync outcomes without awaiting spawn in the sync path; spawn is best-effort.
        void applyFeatureOutcomes(battle, actor, feature, map, "success", random);
      } else if (feature.state === "hidden" && check.total >= (feature.check?.dc ?? 13) - 5) {
        setFeatureState(feature, "hinted");
        syncMarkerForFeature(battle, feature);
        log(battle, actor.name + " notices something odd near " + feature.name + ", but cannot make it out yet.");
      }
    }
    if (!found.length) {
      log(battle, actor.name + " searches carefully but turns up nothing conclusive.");
    }
    return { found, empty: false };
  });
}

/** Investigate a specific feature (Feature Card path). */
export function investigateFeature(battle, actor, feature, map, random = Math.random) {
  awake(battle, actor);
  if (!feature) fail("Choose something to investigate.");
  if (feature.state === "resolved" || feature.state === "triggered") fail("That has already been resolved.");
  if (Number.isInteger(feature.x) && !withinReach(battle, actor, feature, map) && distanceFt(actor, feature) > 10) {
    fail("Move closer to investigate that.");
  }
  return withActionEvent(battle, actor, { action: "Investigate " + feature.name, kind: "check", target: feature.name }, () => {
    spendObjectAction(battle, actor, "investigate");
    if (feature.state === "revealed") {
      log(battle, feature.truthText || feature.surfaceText);
      return { success: true, feature };
    }
    const check = rollFeatureCheck(battle, actor, feature, random);
    if (check.success) {
      void applyFeatureOutcomes(battle, actor, feature, map, "success", random);
      return { success: true, feature };
    }
    log(battle, actor.name + " cannot make sense of it yet.");
    if (feature.state === "hidden") {
      setFeatureState(feature, "hinted");
      syncMarkerForFeature(battle, feature);
    }
    return { success: false, feature };
  });
}

/** Use a revealed mechanism / item-gated feature. */
export function useFeature(battle, actor, feature, map, random = Math.random) {
  awake(battle, actor);
  if (!feature) fail("Choose something to use.");
  if (feature.state !== "revealed" && feature.state !== "triggered") {
    fail("Reveal this fully before using it. Search or Investigate first.");
  }
  if (Number.isInteger(feature.x) && !withinReach(battle, actor, feature, map)) {
    fail("Move within 5 feet with a clear path.");
  }
  if (feature.requiresItem) {
    const needle = feature.requiresItem.toLowerCase();
    const has = (actor.items ?? []).some((item) => String(item.name).toLowerCase().includes(needle));
    if (!has) fail("You need " + feature.requiresItem + " to use this.");
  }
  return withActionEvent(battle, actor, { action: "Use " + feature.name, kind: "ability", target: feature.name }, () => {
    spendObjectAction(battle, actor, "use-feature");
    void applyFeatureOutcomes(battle, actor, feature, map, "use", random);
    if (feature.kind === "treasure" && feature.state === "revealed") {
      // Treasure use reveals loot; actual take still goes through takeLoot.
      log(battle, actor.name + " examines " + feature.name + ".");
    }
    return { feature };
  });
}

/**
 * Fire trap/hazard outcomes when a party member steps on the feature cell.
 * Returns the features that fired (movement should usually stop).
 */
export function triggerFeaturesAt(battle, actor, map, random = Math.random) {
  if (!actor || actor.side !== "party" || actor.x == null) return [];
  const live = (battle.features ?? []).filter((feature) =>
    (feature.kind === "trap" || feature.kind === "hazard") &&
    Number.isInteger(feature.x) && feature.x === actor.x && feature.y === actor.y &&
    (feature.state === "hidden" || feature.state === "hinted" || feature.state === "revealed"));
  const fired = [];
  for (const feature of live) {
    const discovered = feature.state === "hidden" || feature.state === "hinted";
    void applyFeatureOutcomes(battle, actor, feature, map, "trigger", random);
    setFeatureState(feature, "triggered");
    syncMarkerForFeature(battle, feature);
    if (discovered) recordFeatureDiscovery(battle, map, feature);
    fired.push(feature);
  }
  return fired;
}

export function featureCardModel(feature) {
  if (!feature) return null;
  const known = feature.state === "revealed" || feature.state === "resolved" || feature.state === "triggered";
  return {
    id: feature.id,
    name: feature.name,
    kind: feature.kind,
    state: feature.state,
    // Spoiler-safe: surface copy until fully revealed.
    text: known ? (feature.truthText || feature.surfaceText) : feature.surfaceText,
    surfaceText: feature.surfaceText,
    canInvestigate: feature.state === "hinted" || feature.state === "revealed",
    canUse: feature.state === "revealed" || feature.state === "triggered",
    // Hide DC meta until the feature is known.
    check: known ? feature.check : undefined,
    requiresItem: known ? feature.requiresItem : undefined,
  };
}

