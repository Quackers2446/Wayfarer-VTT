import {automaticRoom} from './scene-data.mjs';
import {regionCells} from './encounters.mjs';
import {mapFloor} from './map-walls.mjs';
import {actorIsUp,canTakeTurn,incapacitated,distanceFt,lineClear,canStand,log,spendObjectAction,rollDice,applyDamage,d20,armorClass} from './combat.mjs';
import {creatureSize,containsCell} from './actor-space.mjs';
import {captureImpact,recordAction,withActionEvent} from './action-events.mjs';
const fail=message=>{throw Error(message);};
const potionFormula=name=>({'potion of healing':'2d4+2','healing potion':'2d4+2','potion of greater healing':'4d4+4','potion of superior healing':'8d4+8','potion of supreme healing':'10d4+20'})[name.toLowerCase()];
function awake(battle,actor){if(!actorIsUp(actor)||incapacitated(actor))fail('Choose a conscious character.');if(battle.movement||battle.classReaction)fail('Resolve the pending reaction first.');if(battle.round&&!canTakeTurn(battle,actor))fail('Wait for this character’s turn.');}
export function withinReach(battle,actor,object,map){return object && object.x!=null && object.y!=null && distanceFt(actor,object)<=5 && lineClear(battle,actor,object,map);}
export function syncRewardSheets(battle){for(const actor of battle.actors.filter(a=>a.side==='party')){const sheet=battle.sheets?.[actor.id];if(sheet){if(actor.items)sheet.items=structuredClone(actor.items);if(actor.currency)sheet.currency=structuredClone(actor.currency);if(actor.xp!=null)sheet.xp=actor.xp;}}}
export function lootContents(source){return {items:(source?.loot ?? source?.items ?? []).filter(item=>item.quantity>0),currency:Object.fromEntries(Object.entries(source?.lootCurrency ?? {}).filter(([,amount])=>amount>0))};}
export function takeLoot(battle,actor,source,map,index=null){
 awake(battle,actor);if(!source || source.side && !source.dead)fail('Loot is available on defeated creatures.');
 if(source.carriedBy && source.carriedBy!==actor.id)fail('Another character is carrying this body.');
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
 if(body.carriedBy||actor.carrying)fail('Only one character can carry a body, and only one body at a time.');
 if(!withinReach(battle,actor,body,map))fail('Move within 5 feet of the body with a clear path.');
 const load=bodyWeight(body)+(actor.items??[]).reduce((n,item)=>n+(Number(item.weight)||0)*(Number(item.quantity)||0),0);
 if(load>carryingCapacity(actor))fail('This body is too heavy for your carrying capacity.');
 return withActionEvent(battle,actor,{action:'Pick up '+body.name,kind:'ability',target:body.name},()=>{spendObjectAction(battle,actor,'carry-body');actor.carrying=body.id;body.carriedBy=actor.id;body.x=actor.x;body.y=actor.y;log(battle,actor.name+' picks up '+body.name+'. Carrying a body halves movement speed.');});
}
export function placeBody(battle,actor,body,square,map,{thrown=false}={},random=Math.random){
 awake(battle,actor);if(!body || actor.carrying!==body.id || body.carriedBy!==actor.id)fail('Pick up this body first.');
 if(!Number.isInteger(square?.x)||!Number.isInteger(square?.y)||square.x<0||square.y<0||square.x>=map.cols||square.y>=map.rows)fail('Choose a square on the map.');
 if(distanceFt(actor,square)>(thrown?20:5)||!lineClear(battle,actor,square,map))fail(thrown?'Choose a clear throwing destination within 20 feet.':'Place the body within 5 feet with a clear path.');
 const landing={...body,carriedBy:null};
 const target=thrown && battle.actors.find(target=>target.id!==actor.id && target.id!==body.id && !target.dead && !target.carriedBy && target.x!=null && containsCell(target,square.x,square.y));
 let destination=square;
 if(target){destination=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]].map(([dx,dy])=>({x:square.x+dx,y:square.y+dy})).find(cell=>canStand(battle,landing,cell.x,cell.y,map)&&lineClear(battle,actor,cell,map));}
 if(!destination || !canStand(battle,landing,destination.x,destination.y,map))fail('The body needs an unoccupied, open landing space.');
 return withActionEvent(battle,actor,{action:(thrown?'Throw ':'Place ')+body.name,kind:thrown?'attack':'ability',target:target?.name ?? body.name,targetActor:target?.id ?? body.id},()=>{
  if(thrown)spendObjectAction(battle,actor,'throw-body');
  body.carriedBy=null;actor.carrying=null;const from={x:actor.x,y:actor.y};body.x=destination.x;body.y=destination.y;
  if(thrown && target){
    const attack=d20(actor.ability?.str??0,{random,label:'Improvised body throw'}),critical=attack.kept===20,hit=critical||attack.kept!==1&&attack.total>=armorClass(target);
    recordAction(battle,actor,{outcome:critical?'Critical hit':hit?'Hit':'Miss',roll:attack.kept,total:attack.total,type:'bludgeoning'});
    if(hit){const damage=rollDice('1d4'+((actor.ability?.str??0)>=0?'+':'')+(actor.ability?.str??0),{random,doubleDice:critical,label:'Body throw damage'});const result=applyDamage(battle,target,damage.total,'bludgeoning',critical,random,actor);captureImpact(battle,target,{amount:result.damage,absorbed:result.absorbed,defeated:result.defeated,critical});}
    log(battle,actor.name+' throws '+body.name+' at '+target.name+' — d20 '+attack.kept+' = '+attack.total+' vs AC '+armorClass(target)+': '+(critical?'Critical hit':hit?'Hit':'Miss')+'.');
  }
  if(thrown){const damage=rollDice('1d4' ,{random,label:'Thrown body impact'});applyDamage(battle,body,damage.total,'bludgeoning',false,random,actor);captureImpact(battle,body,{amount:damage.total,defeated:body.dead});}
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
 for(const body of battle.actors){if(!body.carriedBy || !actorIsUp(body))continue;const carrier=battle.actors.find(actor=>actor.id===body.carriedBy);
  if(!carrier){body.carriedBy=null;continue;}
  const destination=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]].map(([dx,dy])=>({x:carrier.x+dx,y:carrier.y+dy})).find(cell=>canStand(battle,{...body,carriedBy:null},cell.x,cell.y,map)&&lineClear(battle,carrier,cell,map));
  if(destination){body.carriedBy=null;carrier.carrying=null;body.x=destination.x;body.y=destination.y;}
 }
}
