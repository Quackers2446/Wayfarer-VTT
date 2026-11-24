import {actorIsUp,occupies,incapacitated,canTakeTurn,turnView,distanceFt,lineClear,canStand,rollDice,d20,armorClass,savingThrow,applyDamage,heal,log,checkCast,spendCast,startConcentration,addCondition,hasFeature,charmedBy,breakInvisibility,advanceTime} from './combat.mjs';
import {actorCells} from './actor-space.mjs';
import {mapFloor,crossesMapWall} from './map-walls.mjs';
import {captureImpact,recordAction,withActionEvent} from './action-events.mjs';
import {customSpellRule} from './spell-rule-store.mjs';
const key=(x,y)=>x+':'+y;
export function lineSquares(a,b){const cells=[];let x=a.x,y=a.y,dx=Math.abs(b.x-x),dy=Math.abs(b.y-y),sx=x<b.x?1:-1,sy=y<b.y?1:-1,err=dx-dy;for(let i=0;i<250;i++){cells.push({x,y});if(x===b.x&&y===b.y)break;const twice=err*2;if(twice>-dy){err-=dy;x+=sx;}if(twice<dx){err+=dx;y+=sy;}}return cells;}
export function customSpellCells(rule,caster,square,map,{end,hotSide='left',area='footprint'}={}){
 const cells=new Set();if(!square||!map)return cells;
 const origin=rule.shape==='self'?caster:square,reach=rule.shape==='line'?Math.ceil(rule.length/5)+3:Math.ceil((rule.radius+rule.nearby)/5)+3;
 const finish=end ?? {x:Math.min(map.cols-1,origin.x+Math.floor(rule.length/5)-1),y:origin.y};
 const line=rule.shape==='line'?lineSquares(origin,finish):[];
 for(let y=Math.max(0,origin.y-reach);y<Math.min(map.rows,origin.y+reach+1);y++)for(let x=Math.max(0,origin.x-reach);x<Math.min(map.cols,origin.x+reach+1);x++){
  if(!mapFloor(map,x,y))continue;let inside=false;const dx=x-origin.x,dy=y-origin.y,dist=Math.hypot(dx,dy)*5;
  if(rule.shape==='line'){
   const wall=line.some(p=>p.x===x&&p.y===y),vx=finish.x-origin.x,vy=finish.y-origin.y,length=Math.hypot(vx,vy)||1,projection=(dx*vx+dy*vy)/(length*length),signed=(vx*dy-vy*dx)/length;
   inside=area==='hotSide'?(wall||projection>=0&&projection<=1&&Math.abs(signed)<=2&&(hotSide==='right'?signed<0:signed>0)):wall;
  }else if(rule.shape==='ring'){
   const wall=Math.abs(dist-rule.radius)<=2.5;inside=area==='hotSide'?(wall||(hotSide==='inside'?dist<rule.radius&&dist>=rule.radius-10:dist>rule.radius&&dist<=rule.radius+10)):wall;
  }else if(rule.shape==='cone'){
   const vx=origin.x-caster.x,vy=origin.y-caster.y,length=Math.hypot(vx,vy)||1,u=x-caster.x,v=y-caster.y,forward=(u*vx+v*vy)/length,side=Math.abs(u*vy-v*vx)/length;inside=forward>0&&forward*5<=rule.radius&&side<=forward/2;
  }else inside=area==='nearby'?Math.max(Math.abs(dx),Math.abs(dy))*5<=rule.radius+rule.nearby:dist<=rule.radius+.01;
  if(inside)cells.add(key(x,y));
 }
 return cells;
}
const touches=(actor,cells)=>actorCells(actor).some(cell=>cells.includes?cells.includes(key(cell.x,cell.y)):cells.has(key(cell.x,cell.y)));
function componentFormula(component,rule,slot,level,ability){
 const extra=rule.level===0&&component.scaleWithCaster?[5,11,17].filter(tier=>level>=tier).length:Math.max(0,slot-rule.level),term=component.upcast?.replace(/\s+/g,'').replace(/[−–]/g,'-');
 return component.formula+(term?Array.from({length:extra},()=>/^[+-]/.test(term)?term:'+'+term).join(''):'')+(component.addAbility?(ability>=0?'+':'')+ability:'');
}
function applyBlock(battle,caster,targets,rule,block,slot,dc,random,critical=false,level=caster.level??1,ability=caster.spellAbility){
 const healing=block.kind==='healing';
 targets=targets.filter(target=>!target.dead&&!(healing&&block.excludeUndeadConstructs&&['undead','construct'].includes(target.creatureType)));
 if(!targets.length)return;
 const rolls=block.damage.map(component=>({component,result:rollDice(componentFormula(component,rule,slot,level,ability),{random,doubleDice:critical&&!healing,label:rule.name+' · '+(healing?'healing':component.type)})}));
 for(const target of targets){
  const saved=block.save?((target.hp===0||incapacitated(target))&&['str','dex'].includes(block.save)?false:savingThrow(target,block.save,{random,advantage:block.save==='dex'&&target.dodging&&actorIsUp(target)}).total>=dc):false;
  if(block.save)log(battle,target.name+' '+block.save.toUpperCase()+' save vs DC '+dc+' · '+(saved?'succeeds':'fails')+'.');
  for(const {component,result} of rolls){
   if(healing){const restored=heal(target,Math.max(0,result.total));captureImpact(battle,target,{amount:restored,healing:true});log(battle,target.name+' regains '+restored+' HP ('+result.breakdown+').');continue;}
   const evasion=block.save==='dex'&&block.onSave==='half'&&hasFeature(target,'Evasion')&&!incapacitated(target),amount=evasion?(saved?0:Math.floor(Math.max(0,result.total)/2)):saved?(block.onSave==='half'?Math.floor(Math.max(0,result.total)/2):0):Math.max(0,result.total);
   const outcome=applyDamage(battle,target,amount,component.type,critical,random,caster,{spell:true,magical:true});captureImpact(battle,target,{amount:outcome.damage,absorbed:outcome.absorbed,defeated:outcome.defeated,critical});log(battle,target.name+' takes '+outcome.damage+' '+component.type+' damage ('+result.breakdown+').');
  }
  if(block.condition&&!saved){if(block.condition==='Prone'){if(!(target.conditionImmune??[]).includes('prone'))target.prone=true;}else addCondition(battle,target,block.condition,rule.duration||6,{source:caster.id,concentration:rule.concentration?caster.id:null});}
 }
}

export function castCustomSpell(battle,caster,target,spell,slot,options={},random=Math.random){
 const rule=customSpellRule(spell.reference ?? spell.key,battle.spellRules);if(!rule)throw Error('This spell has no enabled rules in this room.');
 if(rule.level!==spell.level||rule.edition!==spell.edition)throw Error('The automation must match this spell’s source level and edition.');
 if(rule.shape==='target'&&rule.effects.some(effect=>effect.kind!=='healing'&&(effect.damage.length||effect.condition&&effect.condition!=='Invisible'))&&charmedBy(caster,target))throw Error('This character is charmed by the target.');
 const usage=spell.castUsage&&slot===0?spell.castUsage:undefined;checkCast(battle,caster,rule.level,usage?rule.level:slot,rule.timing,usage,options.slotPool);
 const aimed=!['target','self'].includes(rule.shape),square=rule.shape==='self'?{x:caster.x,y:caster.y}:options.square;
 if(aimed){
  if(!square||!Number.isInteger(square.x)||!Number.isInteger(square.y)||square.x<0||square.y<0||square.x>=options.map?.cols||square.y>=options.map?.rows)throw Error('Choose a point on the map.');
  if(distanceFt(caster,square)>rule.range||!lineClear(battle,caster,square,options.map))throw Error('Choose a point in range with a clear path.');
  if(rule.shape==='line'&&(!options.end||!Number.isInteger(options.end.x)||!Number.isInteger(options.end.y)||options.end.x<0||options.end.y<0||options.end.x>=options.map.cols||options.end.y>=options.map.rows||distanceFt(square,options.end)>rule.length-5||!lineClear(battle,square,options.end,options.map)))throw Error('Choose a clear wall endpoint within its length.');
  if(rule.shape==='sphere'&&!canStand(battle,{id:'spell-sphere'},square.x,square.y,options.map))throw Error('Place the sphere in an unoccupied square.');
 }else if(rule.shape==='target'){
  if(!target||target.dead||target.x==null||distanceFt(caster,target)>rule.range||!lineClear(battle,caster,target,options.map))throw Error('Choose a creature in range with a clear path.');
 }
 if(rule.effects.some(effect=>effect.damage.some(component=>component.addAbility))&&!Number.isFinite(caster.spellAbility))throw Error('Set the spellcasting ability modifier first.');
 if(rule.shape==='target'&&rule.effects.every(effect=>effect.kind==='healing'&&effect.excludeUndeadConstructs)&&['undead','construct'].includes(target?.creatureType))throw Error('This healing rule excludes undead and constructs.');
 if(rule.effects.some(effect=>effect.save)&&!Number.isFinite(caster.spellDC))throw Error('Set this character’s spell save DC first.');
 if(rule.attack&&!Number.isFinite(caster.spellAttack))throw Error('Set this character’s spell attack bonus first.');
 spendCast(battle,caster,rule.level,slot,rule.timing,usage,options.slotPool);breakInvisibility(battle,caster);
 if(rule.concentration)startConcentration(battle,caster,rule.name,rule.duration);
 log(battle,caster.name+' casts '+rule.name+(rule.level?' · level '+(usage?rule.level:slot)+' slot.':'.'));
 let critical=false,hit=true;
 if(rule.attack){const roll=d20(caster.spellAttack,{random,advantage:options.mode==='advantage',disadvantage:options.mode==='disadvantage',label:rule.name+' attack'});critical=roll.kept===20;hit=critical||roll.kept!==1&&roll.total>=armorClass(target);recordAction(battle,caster,{outcome:critical?'Critical hit':hit?'Hit':'Miss',total:roll.total,roll:roll.breakdown,target:target.name,targetActor:target.id});}
 const effectiveSlot=usage?rule.level:slot;
 for(const effect of rule.effects.filter(effect=>effect.trigger==='cast')){
  const cells=aimed?customSpellCells(rule,caster,square,options.map,{...options,area:effect.area}):null;
  const targets=rule.shape==='self'?[caster]:!aimed?[target]:battle.actors.filter(actor=>occupies(actor)&&touches(actor,cells)&&lineClear(battle,square,actor,options.map));
  if(hit)applyBlock(battle,caster,targets,rule,effect,effectiveSlot,caster.spellDC,random,critical);
 }
 if(rule.persistent && (!rule.concentration||caster.concentration?.name===rule.name)){
  const cells=customSpellCells(rule,caster,square??caster,options.map,options),effectCells=rule.effects.map(effect=>[...customSpellCells(rule,caster,square??caster,options.map,{...options,area:effect.area})]);
  const zone={id:crypto.randomUUID(),custom:true,caster:caster.id,name:rule.name,rule:structuredClone(rule),slot:effectiveSlot,dc:caster.spellDC,level:caster.level??1,ability:caster.spellAbility,concentration:rule.concentration,blocksVision:rule.blocksVision,difficult:rule.difficult,cells:[...cells],effectCells,square:square??{x:caster.x,y:caster.y},end:options.end,hotSide:options.hotSide??'left',triggered:{},createdElapsed:battle.elapsed??0,expires:rule.endNextTurn?(battle.round?null:(battle.elapsed??0)+6):(battle.elapsed??0)+rule.duration,endRound:rule.endNextTurn?battle.round+1:null};
  battle.spellZones=[...(battle.spellZones??[]),zone];
 }
}
export function expireCustomZones(battle){battle.spellZones=(battle.spellZones??[]).filter(zone=>{if(!zone.custom)return true;if(!battle.round&&zone.endRound!=null&&(battle.elapsed??0)>=(zone.createdElapsed??0)+6)return false;if(zone.expires!=null&&zone.expires<=(battle.elapsed??0))return false;if(zone.endRound!=null && (battle.round>zone.endRound || battle.actors.find(actor=>actor.id===zone.caster)?.dead && battle.round===zone.endRound && battle.turn>battle.order.indexOf(zone.caster)))return false;return true;});}
export function customZoneTriggers(battle,actor,phase,from,random=Math.random){
 expireCustomZones(battle);if(!actor||actor.dead||actor.carriedBy)return;
 for(const zone of [...(battle.spellZones??[])]){
  if(!zone.custom)continue;const caster=battle.actors.find(actor=>actor.id===zone.caster);if(!caster)continue;
  for(const [i,block] of zone.rule.effects.entries()){
   if(block.trigger!==phase||!touches(actor,zone.effectCells[i]))continue;
   if(phase==='enter'&&from&&touches({...actor,...from},zone.effectCells[i]))continue;
   const turn=battle.round?battle.round+':'+battle.order?.[battle.turn]:Math.floor((battle.elapsed??0)/6),stamp=actor.id+':'+phase+':'+i;
   if(zone.triggered[stamp]===turn)continue;zone.triggered[stamp]=turn;
   withActionEvent(battle,caster,{action:zone.name+' · '+({enter:'entered area',start:'start of turn',end:'end of turn'}[phase]??phase),kind:'spell',target:actor.name,targetActor:actor.id},()=>applyBlock(battle,caster,[actor],zone.rule,block,zone.slot,zone.dc,random,false,zone.level??caster.level??1,zone.ability??caster.spellAbility));
  }
 }
 if(phase==='end')battle.spellZones=(battle.spellZones??[]).filter(zone=>!zone.custom||zone.endRound==null||zone.caster!==actor.id||battle.round<zone.endRound);
}
export function moveCustomSphere(battle,caster,zoneId,square,map,random=Math.random){
 battle=turnView(battle,caster);const zone=battle.spellZones?.find(zone=>zone.id===zoneId&&zone.caster===caster.id&&zone.rule?.shape==='sphere');
 if(!zone||!actorIsUp(caster)||incapacitated(caster)||battle.movement||battle.classReaction)throw Error('This sphere cannot be controlled now.');
 if(battle.round&&(!canTakeTurn(battle,caster)||battle.bonusUsed))throw Error('This character’s bonus action is unavailable.');
 if(!Number.isInteger(square?.x)||!Number.isInteger(square?.y)||square.x<0||square.y<0||square.x>=map.cols||square.y>=map.rows||distanceFt(zone.square,square)>zone.rule.move)throw Error('Choose a sphere destination within '+zone.rule.move+' feet.');
 const path=lineSquares(zone.square,square);for(let i=1;i<path.length;i++)if(!mapFloor(map,path[i].x,path[i].y,battle)||crossesMapWall(map,path[i-1],path[i],battle))throw Error('A wall blocks the sphere’s path.');
 const target=battle.actors.find(actor=>occupies(actor)&&actorCells(actor).some(cell=>cell.x===square.x&&cell.y===square.y));
 const destination=target?path.at(-2):square;if(!destination||!canStand(battle,{id:'spell-sphere'},destination.x,destination.y,map))throw Error('The sphere needs an open stopping square.');
 if(path.slice(1,-1).some(cell=>battle.actors.some(actor=>occupies(actor)&&actorCells(actor).some(c=>c.x===cell.x&&c.y===cell.y))))throw Error('A creature blocks the sphere’s path.');
 return withActionEvent(battle,caster,{action:zone.name+(target?' · Ram':' · Move'),kind:'spell',target:target?.name,targetActor:target?.id},()=>{
  if(battle.round)battle.bonusUsed=true;zone.square=destination;zone.cells=[...customSpellCells(zone.rule,caster,destination,map)];zone.effectCells=zone.rule.effects.map(effect=>[...customSpellCells(zone.rule,caster,destination,map,{area:effect.area})]);
  if(target)for(const block of zone.rule.effects.filter(block=>block.trigger==='ram'))applyBlock(battle,caster,[target],zone.rule,block,zone.slot,zone.dc,random,false,zone.level??caster.level??1,zone.ability??caster.spellAbility);
  log(battle,caster.name+' moves '+zone.name+(target?' into '+target.name:'')+'.');if(!battle.round)advanceTime(battle,6);
 });
}
