import {turnView, canTakeTurn, actorIsUp, condition, currentActor, distanceFt, hasFeature, incapacitated, moveLeft, movementGroup, speedOf, supportedSpell} from "./combat.mjs";
import {classActions} from "./class-actions.mjs";
import {escape} from "./format.mjs";
import {icon} from "./icons.mjs";
import {spellByKey} from "./rules-library.mjs";

const timingNames={action:"Action",bonus:"Bonus action",free:"Free",move:"Movement",flurry:"Follow-up",reaction:"Reaction",hit:"On hit"};
export const hotbarTabs=[["all","All"],["weapon","Weapons"],["spell","Spells"],["feature","Abilities"],["potion","Items"],["common","Common"],["passive","Passives"]];

function plain(entries) {
  const strings=[];
  const walk=node=>{
    if(typeof node==="string" && !node.startsWith("{@i ")) strings.push(node);
    else if(Array.isArray(node)) node.forEach(walk);
    else if(node && typeof node==="object") walk(node.entries ?? node.items);
  };
  walk(entries);
  return (strings[0] ?? "").replace(/\{@\w+ ([^}]+)\}/g,(_,body)=>body.split('|')[0]).slice(0,320);
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
  if(entry.inspect) return "";
  if(entry.mode==='move' && canAct && actorIsUp(actor) && !incapacitated(actor) && !battle.classReaction && !battle.movement && (!battle.round || movementGroup(battle).includes(actor))) return battle.round && moveLeft(battle,actor)<=0 ? 'No movement remains.' : '';
  const blocked=baseReason(actor,battle,canAct);
  if(blocked) return blocked;
  if(entry.mode==="move") return battle.round && moveLeft(battle,actor)<=0 ? "No movement remains." : "";
  if(entry.mode==="passive") return entry.resource && !entry.toggled && !(actor.resources?.[entry.resource]?.current>=entry.cost) ? "Not enough "+(actor.resources?.[entry.resource]?.name ?? entry.resource)+" remaining." : "";
  if(!battle.round) {
    if(entry.mode==="common" && !["help-up","interact","control-spell-zone"].includes(entry.actionId)) return "No turn budget is needed while exploring.";
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
    if(battle.round && entry.timing==="bonus" && (battle.cast?.level || battle.cast?.bonus || battle.cast?.reaction)) return "Another spell has restricted bonus-action casting this turn.";
    if(battle.round && spell.level>0 && entry.timing!=="bonus" && battle.cast?.bonus) return "After a bonus-action spell, your action can only cast a cantrip.";
    if(spell.level>0) {
      const usage=spell.castUsage;
      const feature=usage && (usage.atWill || usage.resource && actor.resources?.[usage.resource]?.current >= (usage.cost ?? 1));
      const ordinary=Object.entries(actor.slots).some(([rank,pool])=>Number(rank)>=spell.level && pool.current>0);
      const pact=actor.resources?.pactMagic;
      if(!feature && !ordinary && !(pact?.current>0 && pact.slotLevel>=spell.level)) return "No spell slot or feature use remains for this spell.";
    }
  }
  if(entry.mode==="potion" && !entry.usable) return "This item has no uses left.";
  if(entry.mode==="common" && entry.actionId==="stand" && moveLeft(battle,actor)<speedOf(actor)/2) return "Standing requires half your movement speed.";
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
    const stats=entry.mode==="weapon" ? [data.damage+(data.type ? " "+data.type : "")+" damage",
      "Attack "+(data.bonus>=0 ? "+" : "")+data.bonus,data.normalRange ? "Range "+data.normalRange+"/"+(data.longRange || data.normalRange)+" ft" : "Reach "+(data.reach || 5)+" ft"] :
      entry.mode==="potion" ? [data.formula+" healing",...(entry.thrown ? ["Range 30 ft"] : []),data.quantity+" remaining"] : [data.level ? "Level "+data.level+" spell" : "Cantrip"];
    const source=data.reference && spellByKey(data.reference);
    entries.push({...entry,id,index,name:entry.thrown ? "Throw "+data.name : data.name,tab:entry.mode,timing,symbol:symbol(data.name,entry.mode),stats,
      description:entry.mode==="spell" ? plain(source?.entries) : entry.mode==="potion" ? entry.thrown ? "Use your action to throw this potion to a creature within 30 feet along a clear path. Consumes one potion and rolls its normal healing." : "Restore hit points with this item." : "Select this attack, then choose a target on the map.",
      resource:data.castUsage?.resource,cost:data.castUsage?.cost ?? (data.castUsage?.maximum ? 1 : undefined),
      level:data.level ?? 0});
  }
  entries.push({id:'common:interact',actionId:'interact',name:actor.carrying?'Carrying body':'Interact',mode:'common',tab:'common',timing:'free',instant:false,symbol:'fist',description:'Select a body or treasure. Loot, carry, place, throw, or help from one contextual menu.'});
  for(const zone of battle.spellZones??[])if(zone.custom&&zone.caster===actor.id&&zone.rule.shape==='sphere')entries.push({id:'zone:'+zone.id,actionId:'control-spell-zone',zoneId:zone.id,name:zone.name+' · Control',mode:'common',tab:'spell',timing:'bonus',instant:false,symbol:'flame',description:'Move up to '+zone.rule.move+' ft or ram a creature. Uses a bonus action, without another spell slot.'});
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
  for(const target of battle.actors.filter(target=>target.side===actor.side && target.x!=null && target.y!=null && !target.dead && condition(target,"Asleep") && Math.max(Math.abs(target.x-actor.x),Math.abs(target.y-actor.y))<=1)) {
    entries.push({id:"common:wake:"+target.id,actionId:"wake",targetId:target.id,name:"Wake "+target.name,mode:"common",tab:"common",timing:"action",instant:true,symbol:"heart",description:"Use your action to shake this adjacent ally awake."});
  }
  if(actor.nimbleEscape && !hasFeature(actor,"Cunning Action")) entries.push({id:"common:bonus-disengage",actionId:"bonus-disengage",name:"Disengage",mode:"common",tab:"common",timing:"bonus",instant:true,symbol:"shield",description:"Use a bonus action to avoid opportunity attacks."});
  if(actor.concentration?.bolt) entries.push({id:"common:witch-bolt",actionId:"witch-bolt",name:"Sustain Witch Bolt",mode:"common",tab:"spell",timing:"action",instant:true,symbol:"sparkles",description:"Deal the sustained damage of your current Witch Bolt without spending another spell slot."});
  if(hasFeature(actor,"Stunning Strike")) entries.push({id:"passive:stunning-strike",actionId:"arm-stun",name:"Stunning Strike",mode:"passive",tab:"feature",timing:"hit",resource:"ki",cost:1,instant:true,toggled:Boolean(actor.stunArmed),symbol:"fist",description:"Toggle Stunning Strike for melee hits, including bonus strikes. Toggling costs nothing; each eligible hit spends 1 Ki to force a Constitution save against being stunned."});
  if(hasFeature(actor,"Deflect Missiles")) entries.push({id:"passive:deflect-hand",actionId:"deflect-hand",name:"Free hand",mode:"passive",tab:"passive",timing:"free",instant:true,toggled:Boolean(actor.freeHand),symbol:"fist",description:"Keep a hand free to catch a missile reduced to zero damage by Deflect Missiles."});
  if(hasFeature(actor,"Cutting Words")) entries.push({id:"passive:cutting-words",actionId:"cutting-words",name:"Cutting Words",mode:"passive",tab:"passive",timing:"reaction",instant:true,toggled:Boolean(actor.cuttingWords),symbol:"award",description:"Toggle automatic Cutting Words reactions. Each use spends one Bardic Inspiration die and your reaction."});
  if(actor.inspiration) entries.push({id:"passive:arm-inspiration",actionId:"arm-inspiration",name:"Use Inspiration",mode:"passive",tab:"passive",timing:"free",instant:true,toggled:Boolean(actor.inspirationArmed),symbol:"award",description:"Add your Bardic Inspiration die to your next supported attack, save, or skill check."});
  entries.push({id:"reference:features",name:"Feature rules",mode:"reference",tab:"passive",timing:"free",symbol:"book",inspect:true,description:"Open your character sheet to read all unlocked features and any choices still to record."});
  for(const entry of entries) {
    entry.reason=entryReason(actor,battle,entry,canAct);
    if(!entry.reason && entry.mode==="spell" && entry.level>0) {
      if(filter.startsWith("slot:") && !(actor.slots[filter.slice(5)]?.current>0)) entry.reason="No level "+filter.slice(5)+" spell slots remain. Choose another slot filter.";
      if(filter.startsWith("pact:") && !(actor.resources?.pactMagic?.current>0)) entry.reason="No Pact Magic slots remain. Choose another slot filter.";
    }
  }
  return entries;
}

export function filterActionBar(entries,tab="all",filter="") {
  return entries.filter(entry=>{
    if(entry.contextual) return false;
    if(tab!=="all" && entry.tab!==tab) return false;
    if(tab==="all" && (entry.tab==="passive" || entry.inspect)) return false;
    if(!filter) return true;
    if(filter==="action") return entry.timing==="action";
    if(filter==="bonus") return entry.timing==="bonus" || entry.timing==="flurry";
    if(filter==="move") return entry.timing==="move" || /dash|step of the wind/i.test(entry.name);
    if(filter.startsWith("resource:")) return entry.resource===filter.slice(9);
    if(filter.startsWith("slot:")) return entry.mode==="spell" && entry.level>0 && entry.level<=Number(filter.slice(5));
    if(filter.startsWith("pact:")) return entry.mode==="spell" && entry.level>0 && entry.level<=Number(filter.slice(5));
    return true;
  });
}

function costs(entry,actor) {
  const values=[timingNames[entry.timing] ?? entry.timing];
  if(entry.resource && entry.cost) values.push(entry.cost+" "+(actor.resources?.[entry.resource]?.name ?? entry.resource));
  else if(entry.mode==="spell" && entry.level>0) values.push(entry.data.castUsage?.atWill ? "At will" : "Spell slot / feature use");
  return values;
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

export function renderActionBar(entries,actor,{tab="all",filter="",selected="",expanded=false,utilitiesOpen=false}={}) {
  const shown=filterActionBar(entries,tab,filter);
  const followups=entries.filter(entry=>entry.contextual);
  return `<section class="game-hotbar${expanded ? ' expanded' : ''}" aria-label="Character hotbar" data-hotbar-view="${escape([actor.id,tab,filter,expanded].join('|'))}">
    <div class="hotbar-toolbar"><nav class="hotbar-tabs" aria-label="Action categories">${hotbarTabs.map(([id,name])=>
      `<button type="button" data-play="hotbar-tab" data-id="${id}" class="hotbar-tab" aria-pressed="${tab===id}">${name}</button>`).join('')}</nav>
    ${filter ? `<div class="hotbar-filter-note"><span>${escape(filter==='bonus' ? 'Bonus' : filter==='action' ? 'Action' : filter==='move' ? 'Movement' : filter.startsWith('resource:') ? actor.resources[filter.slice(9)]?.name ?? 'Resource' : filter.startsWith('pact:') ? 'Pact' : 'Level '+filter.slice(5))}</span>
      <button type="button" data-play="hotbar-filter" data-id="" aria-label="Clear action filter">${icon('close',13)}</button></div>` : ''}
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
  const chip=(id,label,tone,used=false)=>`<button type="button" class="hotbar-resource resource-${tone}${used ? ' spent' : ''}" data-play="hotbar-filter" data-id="${escape(id)}" aria-pressed="${filter===id}" aria-label="Filter ${escape(label)}"><i></i><span>${escape(label)}</span></button>`;
  const attacks=battle.action==="attack" ? Math.max(0,actor.swings-battle.attacksMade) : 0;
  return `<div class="hotbar-resources game-class-resources" aria-label="Action economy and resources">
    ${chip('action',battle.round ? battle.action ? attacks ? attacks+' attack'+(attacks===1 ? '' : 's')+' left' : 'Action spent' : 'Action ready' : 'Actions','action',battle.round && Boolean(battle.action) && !attacks)}
    ${chip('bonus',battle.round ? battle.bonusUsed ? 'Bonus spent' : 'Bonus ready' : 'Bonus actions','bonus',battle.round && battle.bonusUsed)}
    ${Object.entries(actor.resources ?? {}).map(([id,pool])=>chip(pool.slotLevel ? 'pact:'+pool.slotLevel : 'resource:'+id,
      pool.name+' '+pool.current+'/'+pool.maximum,pool.slotLevel ? 'spell' : 'class',pool.current<=0)).join('')}
    ${Object.entries(actor.slots).filter(([,pool])=>pool.maximum>0).map(([rank,pool])=>chip('slot:'+rank,'Level '+rank+' · '+pool.current+'/'+pool.maximum,'spell',pool.current<=0)).join('')}
  </div>`;
}
