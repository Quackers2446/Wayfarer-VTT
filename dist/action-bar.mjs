import {turnView, canTakeTurn, actorIsUp, concentrationRemaining, condition, currentActor, distanceFt, handsOccupied, hasFeature, incapacitated, moveLeft, movementGroup, speedOf, spellNeedsHands, supportedSpell} from "./combat.mjs";
import {thrallsOf} from "./dominate.mjs";
import {classActions} from "./class-actions.mjs";
import {escape} from "./format.mjs";
import {icon} from "./icons.mjs";
import {cachedSpell, primeSpells, spellByKey} from "./rules-library.mjs";
import {isArmed, reactionSpells} from "./reactions.mjs";

const timingNames={action:"Action",bonus:"Bonus action",free:"Free",move:"Movement",flurry:"Follow-up",reaction:"Reaction",hit:"On hit"};
const schoolNames={A:"Abjuration",C:"Conjuration",D:"Divination",E:"Enchantment",V:"Evocation",I:"Illusion",N:"Necromancy",T:"Transmutation"};
export const hotbarTabs=[["all","All"],["weapon","Weapons"],["spell","Spells"],["feature","Abilities"],["potion","Items"],["common","Common"],["passive","Passives"]];

function plain(entries) {
  const strings=[];
  const walk=node=>{
    if(typeof node==="string" && !node.startsWith("{@i ")) strings.push(node);
    else if(Array.isArray(node)) node.forEach(walk);
    else if(node && typeof node==="object") walk(node.entries ?? node.items ?? node.entry);
  };
  walk(entries);
  return strings.join(" ").replace(/\{@\w+ ([^}]+)\}/g,(_,body)=>body.split('|')[0]).replace(/\s+/g," ").trim().slice(0,420);
}

function catalogRange(range) {
  if (!range) return "";
  if (range.type === "special") return "Special";
  const distance = range.distance;
  if (!distance) return range.type || "";
  if (distance.type === "self") return "Self";
  if (distance.type === "touch") return "Touch";
  if (distance.type === "sight") return "Sight";
  if (distance.type === "unlimited") return "Unlimited";
  if (Number.isFinite(distance.amount)) return distance.amount + " ft";
  return distance.type || "";
}

function titleCase(value) {
  return String(value || "").replace(/(^|[\s_-])([a-z])/g, (_, gap, letter) => gap.replace("_", " ") + letter.toUpperCase());
}

function castEffect(definition) {
  return definition?.effects?.find((effect) => (effect.trigger ?? "cast") === "cast") ?? definition?.effects?.[0];
}

/** Mechanical hotbar facts for every catalog spell — not full proprietary spell text. */
function spellHotbarFacts(data, source, definition) {
  const stats = [data.level ? "Level " + data.level + " spell" : "Cantrip"];
  const school = schoolNames[source?.school] || (source?.school?.length > 1 ? source.school : "");
  if (school) stats.push(school);
  const rangeFt = Number.isFinite(definition?.range) && definition.range > 0 ? definition.range + " ft"
    : catalogRange(source?.range);
  if (rangeFt) stats.push("Range " + rangeFt);
  if (definition?.shape && !["creature", "target", "self"].includes(definition.shape)) {
    const size = definition.side || definition.radius || definition.length;
    stats.push(titleCase(definition.shape) + (size ? " " + size + " ft" : ""));
  }
  if (definition?.attack) stats.push((definition.attack === "ranged" ? "Ranged" : "Melee") + " spell attack");
  const effect = castEffect(definition);
  if (effect?.save) {
    stats.push(effect.save.toUpperCase() + " save" + (effect.onSave === "half" ? " (half)" : effect.onSave === "none" ? " (negates)" : ""));
  }
  for (const damage of effect?.damage ?? []) {
    if (!damage?.formula) continue;
    stats.push(damage.formula + (damage.scaleWithCaster ? "+" : "") + " " + damage.type);
  }
  if (effect?.damage?.some((damage) => damage.scaleWithCaster)) stats.push("Scales with level");
  if (definition?.concentration || source?.duration?.some?.((entry) => entry.concentration)) stats.push("Concentration");
  return stats;
}

function spellHotbarDescription(source, definition) {
  const prose = plain(source?.entries);
  if (prose) return prose;
  const effect = castEffect(definition);
  const parts = [];
  if (definition?.attack) parts.push((definition.attack === "ranged" ? "Ranged" : "Melee") + " spell attack");
  if (effect?.save) parts.push(effect.save.toUpperCase() + " saving throw");
  for (const damage of effect?.damage ?? []) {
    if (damage?.formula) parts.push(damage.formula + " " + damage.type + " damage" + (damage.scaleWithCaster ? " (scales)" : ""));
  }
  if (effect?.push?.distance) {
    parts.push((effect.push.mode === "toward" ? "Pull" : "Push") + " " + effect.push.distance + " ft");
  }
  if (definition?.shape && !["creature", "target", "self"].includes(definition.shape)) {
    const size = definition.side || definition.radius || definition.length;
    parts.push(titleCase(definition.shape) + (size ? " " + size + " ft" : ""));
  }
  if (parts.length) return parts.join(" · ");
  const range = catalogRange(source?.range);
  const school = schoolNames[source?.school] || "";
  return [school, range && ("Range " + range)].filter(Boolean).join(" · ")
    || "Attach your 5etools ZIP in Rooms to load this spell’s full entry.";
}

function resolveSpellSource(data) {
  const catalog = data.reference ? spellByKey(data.reference) : null;
  const archived = cachedSpell(data.reference || catalog || {name: data.name, source: data.source || "PHB"});
  if (archived) return {...(catalog ?? {name: data.name, source: data.source, level: data.level}), ...archived};
  return catalog;
}

function featureText(features,name) {
  for(const feature of features ?? []) {
    if(feature.name===name) return plain(feature.entries);
    if(feature && typeof feature==="object") {
      const found=featureText(feature.entries ?? feature.items,name);
      if(found) return found;
    }
  }
  return "";
}

function symbol(name,kind) {
  if(/heal|second wind|restor/i.test(name)) return "heart";
  if(/dash|wind|move|stand/i.test(name)) return "footprints";
  if(/hide|aim|sight/i.test(name)) return "eye";
  if(/defen|dodge|disengage|bladesong/i.test(name)) return "shield";
  if(/flurry|unarmed|martial|astral arms|ki-fueled/i.test(name)) return "fist";
  if(/fire|flame|burning/i.test(name)) return "flame";
  if(/inspir|help/i.test(name)) return "award";
  return kind==="weapon" ? /bow|dart|thrown|sling|crossbow/i.test(name) ? "bow" : "sword" : kind==="potion" ? "potion" : "sparkles";
}

function baseReason(actor,battle,canAct) {
  if(!canAct) return "This character is controlled by another player.";
  if(!actorIsUp(actor)) return "This character is unconscious or defeated.";
  if(incapacitated(actor)) return "This character is incapacitated.";
  if(battle.classReaction || battle.movement) return "Resolve the pending reaction first.";
  if(battle.round && !canTakeTurn(battle,actor)) return "Wait for this character’s action turn.";
  return "";
}

export function entryReason(actor,battle,entry,canAct=true) {
  battle=turnView(battle,actor);
  if(entry.controlZone){const cast=entryReason(actor,battle,{...entry,controlZone:null},canAct),control=entryReason(actor,battle,{mode:'common',timing:'bonus',actionId:'control-spell-zone'},canAct);return cast&&control?cast:'';}
  if(entry.inspect) return "";
  // Ending concentration is free and may happen on any turn (PHB).
  if(entry.actionId==='end-concentration') {
    if(!canAct) return "This character is controlled by another player.";
    if(!actor.concentration) return "This character is not concentrating.";
    return "";
  }
  if(entry.mode==='dominate') {
    if(!canAct) return "This character is controlled by another player.";
    if(!actorIsUp(actor)) return "This character is unconscious or defeated.";
    if(incapacitated(actor)) return "This character is incapacitated.";
    if(battle.classReaction || battle.movement) return "Resolve the pending reaction first.";
    if(!thrallsOf(battle,actor).some((thrall) => thrall.id === entry.thrallId)) return "That creature is no longer dominated.";
    return "";
  }
  if(entry.mode==='move' && canAct && actorIsUp(actor) && !incapacitated(actor) && !battle.classReaction && !battle.movement && (!battle.round || movementGroup(battle).includes(actor))) return battle.round && moveLeft(battle,actor)<=0 ? 'No movement remains.' : '';
  const blocked=baseReason(actor,battle,canAct);
  if(blocked) return blocked;
  if(entry.mode==="move") return battle.round && moveLeft(battle,actor)<=0 ? "No movement remains." : "";
  if(entry.mode==="passive") return entry.resource && !entry.toggled && !(actor.resources?.[entry.resource]?.current>=entry.cost) ? "Not enough "+(actor.resources?.[entry.resource]?.name ?? entry.resource)+" remaining." : "";
  if(!battle.round) {
    if(entry.mode==="common" && !["help-up","interact","control-spell-zone","zone-beam","end-concentration","search","investigate","use-feature"].includes(entry.actionId)) return "No turn budget is needed while exploring.";
    if(entry.mode==="feature") return "Use this class ability during combat.";
  }
  if(entry.mode==="weapon" && battle.round) {
    if(battle.action && battle.action!=="attack") return "Your action has already been used.";
    if(battle.attacksMade>=actor.swings) return "No attacks remain this turn.";
  } else if(battle.round && entry.timing==="action" && battle.action) return "Your action has already been used.";
  if(battle.round && entry.timing==="bonus" && battle.bonusUsed) return "Your bonus action has already been used.";
  if(entry.resource && !(actor.resources?.[entry.resource]?.current>=entry.cost)) return "Not enough "+(actor.resources?.[entry.resource]?.name ?? entry.resource)+" remaining.";
  if(entry.mode==="feature") {
    if(entry.actionId==="flurry" && !battle.attacksMade) return "Take the Attack action first.";
    if(entry.actionId==="martial-arts" && !battle.martialAttack) return "Attack with an unarmed strike or monk weapon first.";
    if(entry.actionId==="ki-fueled" && !battle.kiAction) return "Spend Ki as part of your action first.";
    if(entry.actionId==="steady-aim" && battle.spent) return "Steady Aim requires that you have not moved.";
    if(entry.actionId==="bladesong" && actor.classRules.bladesongAllowed===false) return "Bladesong requires light or no armor and no shield.";
    if(entry.actionId==="stillness" && !condition(actor,"Charmed") && !condition(actor,"Frightened")) return "You are neither charmed nor frightened.";
    if(entry.actionId==="action-surge" && battle.actionSurged) return "Action Surge has already been used this turn.";
  }
  if(entry.mode==="spell") {
    const spell=entry.data;
    if(spell.prepared===false) return "This spell is not prepared.";
    if(!entry.usable) return entry.manual ? "This spell currently requires a manual ruling. See its rules in your character sheet." : "This spell’s effect is not automated yet. See its rules in your character sheet.";
    if(handsOccupied(actor) && spellNeedsHands(spell)) return "Dragging occupies your hands. Only verbal-only spells can be cast.";
    if(battle.round && entry.timing==="bonus" && (battle.cast?.level || battle.cast?.bonus || battle.cast?.reaction)) return "Another spell has restricted bonus-action casting this turn.";
    if(battle.round && spell.level>0 && entry.timing!=="bonus" && battle.cast?.bonus) return "After a bonus-action spell, your action can only cast a cantrip.";
    if(spell.level>0) {
      const usage=spell.castUsage;
      const feature=usage && (usage.atWill || usage.resource && actor.resources?.[usage.resource]?.current >= (usage.cost ?? 1));
      const ordinary=Object.entries(actor.slots).some(([rank,pool])=>Number(rank)>=spell.level && pool.current>0);
      const pact=actor.resources?.pactMagic;
      if(!feature && (usage?.itemOnly || !ordinary && !(pact?.current>0 && pact.slotLevel>=spell.level))) return "No spell slot or feature use remains for this spell.";
    }
  }
  if(entry.mode==="potion" && handsOccupied(actor)) return "Dragging occupies your hands. Drop the creature first.";
  if(entry.mode==="potion" && !entry.usable) return "This item has no uses left.";
  if(entry.mode==="common" && entry.actionId==="stand" && moveLeft(battle,actor)<speedOf(actor)/2) return "Standing requires half your movement speed.";
  if(entry.mode==="weapon" && handsOccupied(actor)) return "Dragging occupies your hands. Drop the creature first.";
  if(entry.mode==="weapon" && !entry.usable) return "Complete this weapon’s attack bonus and damage in your sheet.";
  return "";
}

export function buildActionBar(actor,battle,list,{canAct=true,features=[],filter=""}={}) {
  battle=turnView(battle,actor);
  if(!actor) return [];
  const entries=[{id:"common:move",name:"Move",mode:"move",tab:"common",timing:"move",symbol:"footprints",
    description:"Select a square on the map. Movement is free outside combat; in combat, your path shows the distance and movement remaining."}];
  for(const [index,entry] of list.entries()) {
    if(entry.mode==="custom") continue;
    const data=entry.data;
    const timing=entry.mode==="spell" ? data.timing ?? (supportedSpell(data.reference || data.key)?.bonus ? "bonus" : "action") : "action";
    const id=entry.mode+":"+(entry.mode==="spell" ? data.reference || data.key : data.name+(entry.thrown ? ":throw" : ""));
    const source=entry.mode==="spell" ? resolveSpellSource(data) : null;
    const definition=entry.mode==="spell" ? supportedSpell(data.reference || data.key)?.definition : null;
    const stats=entry.mode==="weapon" ? [data.damage+(data.type ? " "+data.type : "")+" damage",
      "Attack "+(data.bonus>=0 ? "+" : "")+data.bonus,data.normalRange ? "Range "+data.normalRange+"/"+(data.longRange || data.normalRange)+" ft" : "Reach "+(data.reach || 5)+" ft"] :
      entry.mode==="potion" ? [data.formula+" healing",...(entry.thrown ? ["Range 30 ft"] : []),data.quantity+" remaining"] :
      entry.mode==="spell" ? spellHotbarFacts(data, source, definition) : [];
    entries.push({...entry,id,index,name:entry.thrown ? "Throw "+data.name : data.name,tab:entry.mode,timing,symbol:symbol(data.name,entry.mode),stats,
      description:entry.mode==="spell" ? spellHotbarDescription(source, definition) : entry.mode==="potion" ? entry.thrown ? "Use your action to throw this potion to a creature within 30 feet along a clear path. Consumes one potion and rolls its normal healing." : "Restore hit points with this item." : "Select this attack, then choose a target on the map.",
      resource:data.castUsage?.resource,cost:data.castUsage?.cost ?? (data.castUsage?.maximum ? 1 : undefined),
      level:data.level ?? 0});
  }
  const toPrime = entries.filter((entry) => entry.mode === "spell" && (entry.data?.reference || entry.data?.name) && !cachedSpell(entry.data.reference)?.entries?.length)
    .map((entry) => {
      const fromCatalog = entry.data.reference && spellByKey(entry.data.reference);
      if (fromCatalog) return fromCatalog;
      const source = String(entry.data.reference || "").split("|")[0]?.toUpperCase() || entry.data.source || "PHB";
      return {name: entry.data.name, source};
    });
  if (toPrime.length) void primeSpells(toPrime);
  entries.push({id:'common:interact',actionId:'interact',name:actor.carrying?'Carrying body':actor.dragging?'Dragging body':'Interact',mode:'common',tab:'common',timing:'free',instant:false,symbol:'fist',description:'Select a body or treasure. Loot, carry, drag, place, drop, throw, or help from one contextual menu.'});
  entries.push({id:'common:search',actionId:'search',name:'Search',mode:'common',tab:'common',timing:'action',instant:true,symbol:'eye',description:'Search the room for traps, secrets, hidden creatures, and concealed loot. Always reports what you find — or that nothing stands out.'});
  entries.push({id:'common:investigate',actionId:'investigate',name:'Investigate',mode:'common',tab:'common',timing:'action',instant:false,symbol:'eye',description:'Choose a hinted or suspicious feature for a closer look. May require a skill check.'});
  entries.push({id:'common:use-feature',actionId:'use-feature',name:'Use',mode:'common',tab:'common',timing:'action',instant:false,symbol:'fist',description:'Use a revealed mechanism, lever, keyhole, or interactive object. Some uses need a matching item.'});
  for(const zone of battle.spellZones??[])if(zone.custom&&zone.caster===actor.id&&['sphere','movable'].includes(zone.rule.shape)){
    const spell=entries.find(entry=>entry.mode==='spell'&&entry.data.reference===zone.rule.reference);
    if(spell){spell.controlZone=zone.id;spell.stats=[...(spell.stats??[]),'Active sphere · control with a bonus action'];}
    else entries.push({id:'zone:'+zone.id,actionId:'control-spell-zone',zoneId:zone.id,name:zone.name+' · Control',mode:'common',tab:'spell',timing:'bonus',instant:false,symbol:'flame',description:'Move up to '+zone.rule.move+' ft or ram a creature. Uses a bonus action, without another spell slot.'});
  }
  for(const zone of battle.spellZones??[]){
    if(!zone.custom||zone.caster!==actor.id||!zone.rule?.effects?.some(block=>(block.trigger??'cast')==='beam'))continue;
    entries.push({id:'zone-beam:'+zone.id,actionId:'zone-beam',zoneId:zone.id,name:zone.name+' · Beam',mode:'common',tab:'spell',timing:'action',instant:false,symbol:'sparkles',
      description:'Launch a beam of radiance from the wall at a creature you can see within 60 feet of it. Uses your action; ranged spell attack.'});
  }
  for(const action of classActions(actor,battle)) entries.push({id:"feature:"+action.id,name:action.name,actionId:action.id,mode:"feature",tab:"feature",
    timing:action.timing,resource:action.resource,cost:action.cost,symbol:symbol(action.name,"feature"),data:action,
    description:featureText(features,action.feature),contextual:action.timing==="flurry",stats:action.timing==="flurry" ? [battle.flurry+" unarmed strikes remaining"] : [],
    instant:!action.attack && !action.target && !action.area});
  for(const [id,name,description] of [["dash","Dash","Gain another movement allowance equal to your speed. This uses your action."],
    ["dodge","Dodge","Focus on avoiding attacks until your next turn."],["disengage","Disengage","Avoid opportunity attacks for the rest of this turn."]]) {
    entries.push({id:"common:"+id,actionId:id,name,mode:"common",tab:"common",timing:"action",instant:true,symbol:symbol(name,"common"),description});
  }
  if(actor.prone) entries.push({id:"common:stand",actionId:"stand",name:"Stand up",mode:"common",tab:"common",timing:"move",instant:true,symbol:"footprints",description:"Stand from prone by spending half your speed."});
  for(const target of battle.actors.filter(target=>target.side===actor.side && target.x!=null && target.y!=null && !target.dead && target.hp===0 && Math.max(Math.abs(target.x-actor.x),Math.abs(target.y-actor.y))<=1)) {
    entries.push({id:"common:help-up:"+target.id,actionId:"help-up",targetId:target.id,name:"Help Up "+target.name,mode:"common",tab:"common",timing:"action",instant:true,symbol:"heart",description:"Use your action to restore this adjacent unconscious ally to 1 HP."});
  }
  for(const target of battle.actors.filter(target=>target.side===actor.side && target.x!=null && target.y!=null && !target.dead && (condition(target,"Asleep")||condition(target,"Hypnotic Pattern")) && Math.max(Math.abs(target.x-actor.x),Math.abs(target.y-actor.y))<=1)) {
    entries.push({id:"common:wake:"+target.id,actionId:"wake",targetId:target.id,name:"Wake "+target.name,mode:"common",tab:"common",timing:"action",instant:true,symbol:"heart",description:"Use your action to shake this adjacent ally awake."});
  }
  if(actor.nimbleEscape && !hasFeature(actor,"Cunning Action")) entries.push({id:"common:bonus-disengage",actionId:"bonus-disengage",name:"Disengage",mode:"common",tab:"common",timing:"bonus",instant:true,symbol:"shield",description:"Use a bonus action to avoid opportunity attacks."});
  if(actor.concentration) {
    const left=concentrationRemaining(battle,actor);
    const rounds=left?.rounds;
    entries.push({id:"common:end-concentration",actionId:"end-concentration",name:"End Concentration",mode:"common",tab:"spell",timing:"free",instant:true,symbol:"sparkles",
      stats:[actor.concentration.name, rounds!=null ? rounds+(rounds===1?" round left":" rounds left") : null].filter(Boolean),
      description:"Drop concentration on "+actor.concentration.name+" (no action required). The spell ends immediately, along with any zones or conditions it maintains."});
  }
  if(actor.concentration?.bolt) entries.push({id:"common:witch-bolt",actionId:"witch-bolt",name:"Sustain Witch Bolt",mode:"common",tab:"spell",timing:"action",instant:true,symbol:"sparkles",description:"Deal the sustained damage of your current Witch Bolt without spending another spell slot."});
  for(const thrall of thrallsOf(battle,actor)) {
    const controlled=thrall.dominateControl?.from===actor.id;
    entries.push({id:"dominate:"+thrall.id,actionId:"dominate-command",thrallId:thrall.id,name:"Command "+thrall.name,mode:"dominate",tab:"spell",timing:"free",instant:false,symbol:"sparkles",
      stats:[controlled?"Total control active":"Telepathic link",thrall.dominateOrder?"Order pending":"No standing order"],
      description:"Issue a free telepathic command (Attack, Approach, Flee, Dodge, or Dash). The thrall obeys on its turn. Total control spends your action and lasts until the end of your next turn."});
  }
  if(hasFeature(actor,"Stunning Strike")) entries.push({id:"passive:stunning-strike",actionId:"arm-stun",name:"Stunning Strike",mode:"passive",tab:"feature",timing:"hit",resource:"ki",cost:1,instant:true,toggled:Boolean(actor.stunArmed),symbol:"fist",description:"Toggle Stunning Strike for melee hits, including bonus strikes. Toggling costs nothing; each eligible hit spends 1 Ki to force a Constitution save against being stunned."});
  if(hasFeature(actor,"Deflect Missiles")) entries.push({id:"passive:deflect-hand",actionId:"deflect-hand",name:"Free hand",mode:"passive",tab:"passive",timing:"free",instant:true,toggled:Boolean(actor.freeHand),symbol:"fist",description:"Keep a hand free to catch a missile reduced to zero damage by Deflect Missiles."});
  if(hasFeature(actor,"Cutting Words")) entries.push({id:"passive:cutting-words",actionId:"cutting-words",name:"Cutting Words",mode:"passive",tab:"passive",timing:"reaction",instant:true,toggled:Boolean(actor.cuttingWords),symbol:"award",description:"Toggle automatic Cutting Words reactions. Each use spends one Bardic Inspiration die and your reaction."});
  for(const {rule} of reactionSpells(actor,battle.spellRules)) {
    const ref=rule.reference,armed=isArmed(actor,ref);
    entries.push({id:"passive:reaction:"+ref,actionId:armed?"disarm-reaction":"arm-reaction",reactionRef:ref,name:rule.name,mode:"passive",tab:"passive",timing:"reaction",instant:true,toggled:armed,symbol:"shield",description:"Arm this reaction spell so it fires automatically when its trigger happens (Shield on a hit, Absorb Elements on elemental damage, Counterspell when a foe casts, and so on)."});
  }
  if(actor.inspiration) entries.push({id:"passive:arm-inspiration",actionId:"arm-inspiration",name:"Use Inspiration",mode:"passive",tab:"passive",timing:"free",instant:true,toggled:Boolean(actor.inspirationArmed),symbol:"award",description:"Add your Bardic Inspiration die to your next supported attack, save, or skill check."});
  entries.push({id:"reference:features",name:"Feature rules",mode:"reference",tab:"passive",timing:"free",symbol:"book",inspect:true,description:"Open your character sheet to read all unlocked features and any choices still to record."});
  const filters=parseHotbarFilters(filter);
  for(const entry of entries) {
    entry.reason=entryReason(actor,battle,entry,canAct);
    if(!entry.reason && entry.mode==="spell" && entry.level>0) {
      const slotFilters=filters.filter(part=>part.startsWith("slot:"));
      const pactFilters=filters.filter(part=>part.startsWith("pact:"));
      if(slotFilters.length) {
        const match=slotFilters.find(part=>Number(part.slice(5))===entry.level);
        if(match && !(actor.slots[entry.level]?.current>0)) entry.reason="No level "+entry.level+" spell slots remain. Choose another slot filter.";
      }
      if(!entry.reason && pactFilters.some(part=>Number(part.slice(5))===entry.level) && !(actor.resources?.pactMagic?.current>0)) entry.reason="No Pact Magic slots remain. Choose another slot filter.";
    }
  }
  return entries;
}

export function parseHotbarFilters(filter="") {
  return String(filter || "").split(",").map(part=>part.trim()).filter(Boolean);
}

export function toggleHotbarFilter(current="",id="") {
  if(!id) return "";
  const parts=parseHotbarFilters(current);
  if(/^(slot|pact):/.test(id)) {
    const levels=parts.filter(part=>/^(slot|pact):/.test(part));
    const next=levels.includes(id) ? levels.filter(part=>part!==id) : [...levels,id];
    return next.join(",");
  }
  return parts.length===1 && parts[0]===id ? "" : id;
}

export function filterActionBar(entries,tab="all",filter="",query="") {
  const filters=parseHotbarFilters(filter);
  const levels=new Set(filters.filter(part=>/^(slot|pact):/.test(part)).map(part=>Number(part.slice(part.indexOf(":")+1))).filter(Number.isFinite));
  const exclusive=filters.find(part=>!/^(slot|pact):/.test(part)) || "";
  const needle=String(query || "").trim().toLowerCase();
  return entries.filter(entry=>{
    if(entry.contextual) return false;
    if(tab!=="all" && entry.tab!==tab) return false;
    if(tab==="all" && (entry.tab==="passive" || entry.inspect)) return false;
    if(needle && !entry.name.toLowerCase().includes(needle)) return false;
    if(!filters.length) return true;
    if(levels.size) return entry.mode==="spell" && entry.level>0 && levels.has(entry.level);
    if(exclusive==="action") return entry.timing==="action";
    if(exclusive==="bonus") return entry.timing==="bonus" || entry.timing==="flurry";
    if(exclusive==="move") return entry.timing==="move" || /dash|step of the wind/i.test(entry.name);
    if(exclusive.startsWith("resource:")) return entry.resource===exclusive.slice(9);
    return true;
  });
}

function costs(entry,actor) {
  const values=[timingNames[entry.timing] ?? entry.timing];
  if(entry.resource && entry.cost) values.push(entry.cost+" "+(actor.resources?.[entry.resource]?.name ?? entry.resource));
  else if(entry.mode==="spell" && entry.level>0) values.push(entry.data.castUsage?.atWill ? "At will" : "Spell slot / feature use");
  return values;
}

const kindLabels={weapon:"Weapon",spell:"Spell",potion:"Item",feature:"Ability",passive:"Passive",
  common:"Action",move:"Movement",dominate:"Dominate",reference:"Reference"};

function pushFact(facts,label,value) {
  if(value==null || value==="") return;
  facts.push([label,String(value)]);
}

/** Structured detail payload for hotbar right-click inspect dialogs. */
export function hotbarDetailModel(entry,actor={},extras={}) {
  if(!entry) return null;
  const data=entry.data ?? {};
  const facts=[];
  pushFact(facts,"Type",kindLabels[entry.mode] ?? titleCase(entry.mode));
  pushFact(facts,"Timing",timingNames[entry.timing] ?? entry.timing);
  if(entry.resource && entry.cost) {
    pushFact(facts,"Cost",entry.cost+" "+(actor.resources?.[entry.resource]?.name ?? entry.resource));
  }
  if(entry.toggled!=null) pushFact(facts,"Armed",entry.toggled ? "On" : "Off");

  if(entry.mode==="weapon") {
    pushFact(facts,"Attack",(data.bonus>=0 ? "+" : "")+(data.bonus ?? ""));
    pushFact(facts,"Damage",[data.damage,data.type].filter(Boolean).join(" "));
    if(data.normalRange) pushFact(facts,"Range",data.normalRange+"/"+(data.longRange || data.normalRange)+" ft");
    else pushFact(facts,"Reach",(data.reach || 5)+" ft");
    const traits=[data.finesse && "Finesse",data.rangedWeapon && "Ranged",data.monkWeapon && "Monk weapon",
      data.unarmed && "Unarmed",data.spellAttack && "Spell attack"].filter(Boolean);
    if(traits.length) pushFact(facts,"Properties",traits.join(", "));
    if(data.note) pushFact(facts,"Note",data.note);
  } else if(entry.mode==="spell") {
    pushFact(facts,"Level",entry.level ? "Level "+entry.level : "Cantrip");
    for(const stat of entry.stats ?? []) {
      if(/^(level \d|cantrip)/i.test(stat)) continue;
      const range=/^Range\s+(.+)$/i.exec(stat);
      if(range){pushFact(facts,"Range",range[1]);continue;}
      if(Object.values(schoolNames).includes(stat)){pushFact(facts,"School",stat);continue;}
      if(/spell attack/i.test(stat)){pushFact(facts,"Attack",stat);continue;}
      if(/\bsave\b/i.test(stat)){pushFact(facts,"Save",stat);continue;}
      if(/concentration/i.test(stat)){pushFact(facts,"Duration","Concentration");continue;}
      if(/scales with level/i.test(stat)){pushFact(facts,"Scaling","Scales with level");continue;}
      if(/\d+d\d|\bdamage\b|\b\w+ (acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b/i.test(stat)){
        pushFact(facts,"Damage",stat);continue;
      }
      pushFact(facts,"Detail",stat);
    }
    if(data.castUsage?.atWill) pushFact(facts,"Uses","At will");
    else if(data.castUsage?.resource) pushFact(facts,"Uses",
      (data.castUsage.cost ?? 1)+" "+(actor.resources?.[data.castUsage.resource]?.name ?? data.castUsage.resource));
  } else if(entry.mode==="potion") {
    pushFact(facts,"Healing",data.formula);
    pushFact(facts,"Quantity",data.quantity);
    if(entry.thrown) pushFact(facts,"Range","30 ft");
  } else if(entry.mode==="feature") {
    if(data.feature) pushFact(facts,"Feature",data.feature);
    if(data.attack) pushFact(facts,"Attack","Makes an attack");
    if(data.target) pushFact(facts,"Target",titleCase(data.target));
    if(data.area) pushFact(facts,"Area",data.area+" ft");
  } else if(entry.mode==="dominate") {
    for(const stat of entry.stats ?? []) pushFact(facts,"Status",stat);
  } else {
    for(const stat of entry.stats ?? []) pushFact(facts,"Detail",stat);
  }

  // Collapse repeated Detail rows into unique values while preserving labeled facts.
  const seen=new Set();
  const compact=[];
  for(const [label,value] of facts) {
    const key=label+"|"+value;
    if(seen.has(key)) continue;
    seen.add(key);
    compact.push([label,value]);
  }

  const spellKey=entry.mode==="spell" ? (data.reference || null) :
    entry.reactionRef || null;
  const featureName=entry.mode==="feature" ? (data.feature || entry.name) :
    entry.mode==="passive" ? (data.feature || entry.name) : null;

  return {
    id:entry.id,
    mode:entry.mode,
    name:entry.name,
    symbol:entry.symbol || "book",
    inspect:Boolean(entry.inspect),
    spellKey,
    featureName,
    subtitle:[kindLabels[entry.mode] ?? titleCase(entry.mode), timingNames[entry.timing] ?? entry.timing]
      .filter(Boolean).join(" · "),
    facts:compact,
    description:entry.description || "",
    entries:extras.entries ?? null,
    reason:entry.reason || "",
  };
}

export function renderActionTile(entry,actor,selected,shortcut) {
  const cost=costs(entry,actor),id="hotbar-tip-"+(shortcut ?? entry.id.replace(/[^a-z\d]/gi,'-'));
  return `<button type="button" id="${escape('hotbar-tile-'+entry.id)}" class="hotbar-tile tone-${entry.mode}${entry.reason ? " unavailable" : ""}${entry.contextual ? " contextual" : ""}"
    data-play="hotbar-select" data-id="${escape(entry.id)}"${shortcut!=null ? ' data-hotbar-shortcut="'+shortcut+'"' : ''}
    aria-label="${escape(entry.name+' · '+cost.join(' + '))}" aria-pressed="${selected===entry.id || entry.toggled ? 'true' : 'false'}"
    aria-disabled="${Boolean(entry.reason)}" aria-describedby="${escape(id)}">
    ${shortcut!=null ? '<kbd>'+shortcut+'</kbd>' : ''}${entry.cost && entry.resource ? '<span class="hotbar-charge">'+entry.cost+' '+escape(actor.resources[entry.resource]?.name==='Ki' ? 'Ki' : 'use')+'</span>' : entry.mode==='potion' ? '<span class="hotbar-charge">×'+entry.data.quantity+'</span>' : entry.mode==='spell' ? '<span class="hotbar-charge">'+(entry.level ? 'L'+entry.level : 'C')+'</span>' : ''}
    <span class="hotbar-glyph">${icon(entry.symbol,27)}</span><span class="hotbar-name">${escape(entry.name.replace(/^Cunning Action · /,''))}</span>
    <span class="hotbar-cost timing-${entry.timing}"><i></i>${escape(entry.toggled!=null ? entry.toggled ? 'On' : 'Off' : timingNames[entry.timing] ?? entry.timing)}</span>
    <span class="hotbar-tooltip" id="${escape(id)}" role="tooltip"><strong>${escape(entry.name)}</strong><span class="hotbar-tooltip-cost">${escape(cost.join(' + '))}</span>
      ${(entry.stats ?? []).map(stat=>'<span>'+escape(stat)+'</span>').join('')}<span>${escape(entry.description)}</span>
      ${entry.reason ? '<em>'+escape(entry.reason)+'</em>' : '<em>Click to '+(entry.inspect ? 'open your sheet' : entry.instant ? 'use' : 'select')+'.</em>'}</span>
  </button>`;
}

function filterNote(filter,actor) {
  const filters=parseHotbarFilters(filter);if(!filters.length) return "";
  const levels=filters.filter(part=>/^(slot|pact):/.test(part)).map(part=>part.startsWith('pact:') ? 'Pact '+part.slice(5) : 'Level '+part.slice(5));
  if(levels.length) return levels.join(' · ');
  const exclusive=filters[0];
  return exclusive==='bonus' ? 'Bonus' : exclusive==='action' ? 'Action' : exclusive==='move' ? 'Movement' : exclusive.startsWith('resource:') ? actor.resources[exclusive.slice(9)]?.name ?? 'Resource' : exclusive;
}

export function renderActionBar(entries,actor,{tab="all",filter="",query="",selected="",expanded=false,utilitiesOpen=false}={}) {
  const shown=filterActionBar(entries,tab,filter,query);
  const followups=entries.filter(entry=>entry.contextual);
  return `<section class="game-hotbar${expanded ? ' expanded' : ''}" aria-label="Character hotbar" data-hotbar-view="${escape([actor.id,tab,filter,query,expanded].join('|'))}">
    <div class="hotbar-toolbar"><nav class="hotbar-tabs" aria-label="Action categories">${hotbarTabs.map(([id,name])=>
      `<button type="button" data-play="hotbar-tab" data-id="${id}" class="hotbar-tab" aria-pressed="${tab===id}">${name}</button>`).join('')}</nav>
    ${filter ? `<div class="hotbar-filter-note"><span>${escape(filterNote(filter,actor))}</span>
      <button type="button" data-play="hotbar-filter" data-id="" aria-label="Clear action filter">${icon('close',13)}</button></div>` : ''}
      <label class="hotbar-search"><span class="sr-only">Search actions</span><input id="hotbar-search" type="search" data-play="hotbar-search" value="${escape(query)}" placeholder="Search" aria-label="Search weapons and spells"></label>
      <button type="button" class="hotbar-tab hotbar-tools" data-play="hotbar-tools" aria-pressed="${utilitiesOpen}" aria-label="Checks and resting">Checks</button>
      <button type="button" class="hotbar-expand hotbar-scroll" data-play="hotbar-scroll" data-id="back" aria-label="Scroll actions left">‹</button>
      <button type="button" class="hotbar-expand hotbar-scroll" data-play="hotbar-scroll" data-id="next" aria-label="Scroll actions right">›</button>
      <button type="button" class="hotbar-expand" data-play="hotbar-expand" aria-label="${expanded ? 'Collapse' : 'Expand'} hotbar" aria-expanded="${expanded}">${icon(expanded ? 'down' : 'plus',15)}</button></div>
    <div class="hotbar-action-row">${followups.length ? '<div class="hotbar-followups"><span>Follow-up strikes</span>'+followups.map(entry=>renderActionTile(entry,actor,selected)).join('')+'</div>' : ''}
      <div class="hotbar-grid" role="group" aria-label="Available actions">${shown.map((entry,index)=>renderActionTile(entry,actor,selected,index<10 ? (index+1)%10 : undefined)).join('') ||
      '<p class="hotbar-empty">No actions match. Clear the filter or choose All.</p>'}</div></div>
  </section>`;
}

export function renderActionResources(actor,battle,filter="") {
  battle=turnView(battle,actor);
  if(!actor) return "";
  const active=new Set(parseHotbarFilters(filter));
  const chip=(id,label,tone,used=false)=>`<button type="button" class="hotbar-resource resource-${tone}${used ? ' spent' : ''}" data-play="hotbar-filter" data-id="${escape(id)}" aria-pressed="${active.has(id)}" aria-label="Filter ${escape(label)}"><i></i><span>${escape(label)}</span></button>`;
  const attacks=battle.action==="attack" ? Math.max(0,actor.swings-battle.attacksMade) : 0;
  return `<div class="hotbar-resources game-class-resources" aria-label="Action economy and resources">
    ${chip('action',battle.round ? battle.action ? attacks ? attacks+' attack'+(attacks===1 ? '' : 's')+' left' : 'Action spent' : 'Action ready' : 'Actions','action',battle.round && Boolean(battle.action) && !attacks)}
    ${chip('bonus',battle.round ? battle.bonusUsed ? 'Bonus spent' : 'Bonus ready' : 'Bonus actions','bonus',battle.round && battle.bonusUsed)}
    ${Object.entries(actor.resources ?? {}).map(([id,pool])=>chip(pool.slotLevel ? 'pact:'+pool.slotLevel : 'resource:'+id,
      pool.name+' '+pool.current+'/'+pool.maximum,pool.slotLevel ? 'spell' : 'class',pool.current<=0)).join('')}
    ${Object.entries(actor.slots).filter(([,pool])=>pool.maximum>0).map(([rank,pool])=>chip('slot:'+rank,'Level '+rank+' · '+pool.current+'/'+pool.maximum,'spell',pool.current<=0)).join('')}
  </div>`;
}
