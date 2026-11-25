// Data-driven spell engine (rule schema v2).  Pure: no DOM, randomness is injected, all state lives in `battle` (JSON).
// A rule is cast with castCustomSpell(); persistent areas live in battle.spellZones and are driven by customZoneTriggers().
import {resolveSpellAnimation,spellVisualEvent,formRule} from './spell-animation-library.mjs';
import {actorIsUp,occupies,incapacitated,canTakeTurn,turnView,distanceFt,lineClear,canStand,rollDice,d20,armorClass,savingThrow,applyDamage,heal,log,checkCast,spendCast,startConcentration,endConcentration,addCondition,hasFeature,charmedBy,breakInvisibility,advanceTime,addSpellRollModifiers,addInspiration,attackMode,canSee,checkSpellTethers,joinInitiative,applyAttackRiders,fleeFrom,condition as getCondition,removeCondition,weaponAttackForSpell} from './combat.mjs';
import {actorCells} from './actor-space.mjs';
import {mapFloor,crossesMapWall} from './map-walls.mjs';
import {captureImpact,recordAction,withActionEvent} from './action-events.mjs';
import {customSpellRule} from './spell-rule-store.mjs';
import {migrateRule} from './spell-rule-schema.mjs';
import {shapeCells,lineSquares,isAimed,directional,originatesAtCaster} from './spell-shapes.mjs';
import {scaledTargets,scaledSize,scaledDuration,extraSlots,casterTier} from './spell-scaling.mjs';
import {autoFailsSave,endStatuses,modsOf} from './conditions.mjs';
import {fireReactions, tryCounterspell} from './reactions.mjs';
import {forcedMove} from './forced-movement.mjs';
import {spawnSummons,summonedBy} from './summons.mjs';
import {ruleKey} from './spell-rule-schema.mjs';
export {lineSquares};
const key=(x,y)=>x+':'+y;
const isMagicMissile=rule=>ruleKey(rule.name)==='magic missile';

// ───────────── geometry helpers ─────────────
// The rule with radius/side/length grown for the slot actually used.
export function sizedRule(rule,slot){
 if(!rule.scale)return rule;
 const sized={...rule};for(const field of ['radius','side','length'])if(rule[field]!=null)sized[field]=scaledSize(rule,field,slot);return sized;
}
export function customSpellCells(rule,caster,square,map,options={}){return shapeCells(rule.version===2?rule:migrateRule(rule),caster,square,map,options);}
const touches=(actor,cells)=>actorCells(actor).some(cell=>cells.includes?cells.includes(key(cell.x,cell.y)):cells.has(key(cell.x,cell.y)));
const upgradeZone=zone=>{if(zone.rule&&zone.rule.version!==2)zone.rule=migrateRule(zone.rule);return zone.rule;};

// ───────────── formula helpers ─────────────
function stepFormula(base,upcast,count){const term=upcast?.replace(/\s+/g,'').replace(/[−–]/g,'-');return base+(term?Array.from({length:count},()=>/^[+-]/.test(term)?term:'+'+term).join(''):'');}
function componentFormula(component,rule,slot,level,ability){
 const extra=rule.level===0&&component.scaleWithCaster?casterTier(level):Math.floor(extraSlots(rule,slot)/(component.upcastStep??1));
 return stepFormula(component.formula,component.upcast,extra)+(component.addAbility?(ability>=0?'+':'')+ability:'');
}

// ───────────── statuses ─────────────
function compileStatus(spec,ctx){
 const {rule,slot,reaction}=ctx,extra=extraSlots(rule,slot),mods={};
 for(const field of ['acBonus','acBase','speedBonus','speedMultiplier','attack','attackedBy','attackedNear','attackedFar','check','save','saveBonus','immune','vulnerable','resistAll','autoFail','noReactions','incapacitated','speedZero','negateFall','extraAction','images','exhale','retaliation','blockMagicMissile'])if(spec[field]!=null)mods[field]=structuredClone(spec[field]);
 if(spec.maxHpBonus!=null||spec.maxHpBonusPerSlot!=null)mods.maxHpBonus=(spec.maxHpBonus??0)+extra*(spec.maxHpBonusPerSlot??0);
 if(spec.resist)mods.resist=spec.resist.map(type=>type==='triggering'?reaction?.damageType:type).filter(Boolean);
 for(const field of ['riders','markRiders'])if(spec[field]?.length)mods[field]=spec[field].map(rider=>({formula:stepFormula(rider.formula,rider.upcast,Math.floor(extra/(rider.upcastStep??1))),type:rider.type,when:rider.when??'weapon',consume:Boolean(rider.consume)}));
 return mods;
}
// {when,actor,round}: expire at the start/end of an actor's next turn.  Only meaningful in initiative.
function untilStamp(battle,until,caster,target){
 if(!until||!battle.round)return undefined;
 const subject=until.startsWith('caster')?caster:target,when=until.endsWith('Start')?'start':'end',current=battle.order.indexOf(battle.order[battle.turn]),mine=battle.order.indexOf(subject.id);
 const later=mine>current;
 return {when,actor:subject.id,round:later?battle.round:battle.round+1};
}
function addStatus(ctx,target,spec){
 const {battle,caster,rule,slot}=ctx,name=spec.name??rule.name,mods=compileStatus(spec,ctx),duration=spec.duration??scaledDuration(rule,slot),props={source:caster.id,concentration:rule.concentration?caster.id:null,spell:rule.reference,spellLevel:rule.level};
 if(Object.keys(mods).length)props.mods=mods;
 if(spec.rollModifiers)props.rollModifiers=structuredClone(spec.rollModifiers);
 if(spec.ends)props.ends=structuredClone(spec.ends);
 if(ctx.reaction?.damageType)props.triggerType=ctx.reaction.damageType;
 const until=untilStamp(battle,spec.until,caster,target);if(until)props.until=until;
 props.statusOnly=true;
 target.conditions=(target.conditions??[]).filter(entry=>!(entry.name===name&&(entry.spell===rule.reference||entry.rollModifiers&&!entry.spell)));
 addCondition(battle,target,name,spec.until?Math.max(duration,12):duration||6,props);
}

// ───────────── block application ─────────────
function relation(caster,target){return target.id===caster.id?'self':target.side===caster.side?'allies':target.side==='neutral'?'neutral':'enemies';}
const allowedByAffects=(caster,target,affects)=>!affects||affects==='all'||(affects==='others'?target.id!==caster.id:affects==='allies'?target.side===caster.side:relation(caster,target)==='enemies');
function resolveSave(ctx,target,ability,cacheKey){
 const {battle,random,dc}=ctx;
 if(cacheKey&&ctx.saves?.has(cacheKey+':'+ability))return ctx.saves.get(cacheKey+':'+ability);
 const saved=target.hp===0&&['str','dex'].includes(ability)||autoFailsSave(target,ability)?false:savingThrow(target,ability,{random,advantage:ability==='dex'&&target.dodging&&actorIsUp(target)}).total>=dc;
 log(battle,target.name+' '+ability.toUpperCase()+' save vs DC '+dc+' · '+(saved?'succeeds':'fails')+'.');
 ctx.saves?.set(cacheKey+':'+ability,saved);
 return saved;
}
function dispelOn(ctx,target,level){
 const {battle,caster,random}=ctx;
 for(const entry of [...(target.conditions??[])].filter(entry=>entry.spell)){
  let ended=entry.spellLevel<=level;
  if(!ended){const check=d20(Number.isFinite(caster.spellAbility)?caster.spellAbility:0,{random,label:'Dispel check'});ended=check.total>=10+entry.spellLevel;log(battle,caster.name+' tries to dispel '+entry.name+' (level '+entry.spellLevel+') — '+check.total+' vs DC '+(10+entry.spellLevel)+(ended?', succeeds.':', fails.'));}
  if(ended){target.conditions=target.conditions.filter(other=>other!==entry);log(battle,entry.name+' ends on '+target.name+'.');}
 }
}
function applyBlock(ctx,targets,block,{critical=false,multiplier=1,entryKey=''}={}){
 const {battle,caster,rule,slot,dc,random}=ctx,kind=block.kind??'damage',healing=kind==='healing',recipient=block.to??'targets';
 if(recipient==='self')targets=[caster];else if(recipient==='source')targets=ctx.reaction?.source?[ctx.reaction.source]:[];
 targets=targets.filter(target=>!target.dead&&!(block.excludeTypes&&block.excludeTypes.includes(target.creatureType))&&(recipient!=='targets'||allowedByAffects(caster,target,block.affects)));
 if(!targets.length)return;
 if(kind==='teleport'||kind==='summon'){return;}
 if(kind==='dispel'){for(const target of targets)dispelOn(ctx,target,block.dispel.level);return;}
 if(kind==='sleep'){
  const poolRoll=rollDice(stepFormula(block.sleepPool,block.sleepPoolUpcast,extraSlots(rule,slot)),{random,label:rule.name+' · HP pool'});
  let pool=poolRoll.total;log(battle,rule.name+' HP pool — '+poolRoll.breakdown+' = '+pool+'.');
  const eligible=targets.filter(actor=>actorIsUp(actor)&&!getCondition(actor,'Asleep')&&!actor.sleepImmune&&!(actor.conditionImmune??[]).map(v=>String(v).toLowerCase()).includes('charmed')).sort((a,b)=>a.hp-b.hp);
  for(const creature of eligible){
   if(creature.hp>pool)break;pool-=creature.hp;
   addCondition(battle,creature,block.condition||'Asleep',block.conditionDuration||scaledDuration(rule,slot)||60,{source:caster.id,concentration:rule.concentration?caster.id:null,spell:rule.reference,spellLevel:rule.level,ends:{onDamaged:true}});
  }
  return;
 }
 const rolls=(block.damage??[]).map(component=>({component,result:rollDice(componentFormula(component,rule,slot,ctx.level,ctx.ability),{random,doubleDice:critical&&!healing,label:rule.name+' · '+(healing?'healing':component.type)})}));
 const tempFormula=block.tempHp?stepFormula(block.tempHp,block.tempHpUpcast,extraSlots(rule,slot)):'';
 const missiles=isMagicMissile(rule);
 for(const target of targets){
  if(missiles&&!healing){
   // 2014 Shield: cast as a reaction when targeted by Magic Missile, then take no damage from it.
   fireReactions(battle,'magicMissile',{reactor:target,source:caster,map:ctx.map},random);
   if(modsOf(target).blockMagicMissile){log(battle,target.name+' takes no damage from Magic Missile (Shield).');continue;}
  }
  const saved=block.save?resolveSave(ctx,target,block.save,entryKey+target.id):false;
  let dealt=0;
  for(const {component,result} of rolls){
   if(healing){const restored=heal(target,Math.max(0,result.total));captureImpact(battle,target,{amount:restored,healing:true});log(battle,target.name+' regains '+restored+' HP ('+result.breakdown+').');continue;}
   const base=Math.max(0,result.total)*multiplier,evasion=block.save==='dex'&&block.onSave==='half'&&hasFeature(target,'Evasion')&&!incapacitated(target),amount=evasion?(saved?0:Math.floor(base/2)):saved?(block.onSave==='half'?Math.floor(base/2):0):base;
   const outcome=applyDamage(battle,target,amount,component.type,critical,random,caster,{spell:true,magical:true,map:ctx.map});dealt+=outcome.damage;log(battle,target.name+' takes '+outcome.damage+' '+component.type+' damage ('+(multiplier>1?multiplier+' × ':'')+result.breakdown+').');
  }
  if(block.healFraction&&dealt>0){const restored=heal(caster,Math.floor(dealt*block.healFraction));if(restored){captureImpact(battle,caster,{amount:restored,healing:true});log(battle,caster.name+' regains '+restored+' HP from '+rule.name+'.');}}
  if(saved){continue;}
  if(tempFormula&&actorIsUp(target)){
   const roll=rollDice(tempFormula,{random,label:rule.name+' · temporary HP'});
   const keep=ctx.options?.keepTemp&&(target.tempHp??0)>0;
   if(!keep||roll.total>(target.tempHp??0)){
    target.tempHp=roll.total;target.tempExpires=(battle.elapsed??0)+(rule.duration||3600);
    target.agathys=block.retaliation?roll.total:null;
   }
   log(battle,target.name+' has '+target.tempHp+' temporary HP.');
  }
  if(block.condition){
   if(block.condition==='Prone'){if(!(target.conditionImmune??[]).includes('prone'))target.prone=true;}
   else{
    const extra={source:caster.id,concentration:rule.concentration?caster.id:null,spell:rule.reference,spellLevel:rule.level};
    if(block.repeatSave){extra.repeatSave=block.save;extra.repeatWhen=block.repeatSave;extra.dc=dc;}
    if(block.escape)extra.escape={ability:block.escape.ability,dc};
    if(block.endsOnDamage)extra.ends={onDamaged:true};
    if(block.dominated)extra.dominated=true;
    addCondition(battle,target,block.condition,block.conditionDuration||scaledDuration(rule,slot)||6,extra);
   }
  }
  if(block.status){
   const spec={...block.status};
   if(spec.exhale){
    if(!ctx.options?.damageType)throw Error('Choose a damage type for '+rule.name+'.');
    addCondition(battle,target,"Dragon’s Breath",scaledDuration(rule,slot)||60,{
     concentration:rule.concentration?caster.id:null,source:caster.id,spell:rule.reference,spellLevel:rule.level,
     type:ctx.options.damageType,dc,dice:3+extraSlots(rule,slot),exhale:spec.exhale,statusOnly:true,
     mods:compileStatus({...spec,exhale:undefined},ctx)
    });
   }else addStatus(ctx,target,spec);
  }
  if(block.images)addStatus(ctx,target,{name:rule.name,images:block.images,duration:scaledDuration(rule,slot)||60});
  if(block.pendingDamage&&actorIsUp(target)){
   const pending={formula:stepFormula(block.pendingDamage.formula,block.pendingDamage.upcast,extraSlots(rule,slot)),type:block.pendingDamage.type};
   const until=untilStamp(battle,'targetEnd',caster,target)??{when:'end',actor:target.id,round:(battle.round||1)+1};
   addCondition(battle,target,rule.name+' · lingering',12,{source:caster.id,concentration:rule.concentration?caster.id:null,spell:rule.reference,spellLevel:rule.level,pendingDamage:pending,until,statusOnly:true});
  }
  if(block.push&&ctx.map&&actorIsUp(target))forcedMove(battle,target,ctx.reaction?.source??caster,block.push.distance,ctx.map,{mode:block.push.mode,maxSize:block.push.maxSize,random});
  if(block.flee&&ctx.map&&actorIsUp(target))fleeFrom(battle,caster,target,ctx.map);
  if(block.tether&&caster.concentration){
   const spec=block.tether===true?{}:block.tether;
   caster.concentration.bolt=target.id;
   caster.concentration.boltDice=spec.formula||((block.damage?.[0]?.formula)||'1d12');
   caster.concentration.boltType=spec.type||block.damage?.[0]?.type||'lightning';
   caster.concentration.boltRange=spec.range||30;
   if(battle.round)battle.action='witch-bolt';
  }
 }
}

// ───────────── casting ─────────────
const hostileBlock=block=>block.kind!=='healing'&&(block.damage?.length||block.save||block.condition&&block.condition!=='Invisible');
function targetProblem(caster,chosen,filter){
 if(!filter)return '';
 const type=chosen.creatureType??'humanoid';
 if(filter.side==='ally'&&(chosen.side!==caster.side||filter.self===false&&chosen.id===caster.id))return 'is not an ally';
 if(filter.side==='enemy'&&(chosen.side===caster.side||chosen.side==='neutral'))return 'is not an enemy';
 if(filter.side==='other'&&chosen.id===caster.id)return 'is the caster';
 if(filter.types?.length&&!filter.types.includes(type))return 'is the wrong type of creature';
 if(filter.exclude?.includes(type))return 'is an excluded type of creature';
 if(filter.maxHp!=null&&chosen.hp>filter.maxHp)return 'has too many hit points';
 return '';
}
// A concentration spell whose targets all resisted has nothing to maintain.
const anchored=(battle,caster)=>Boolean(caster.concentration?.bolt)||battle.actors.some(actor=>actor.conditions?.some(entry=>entry.concentration===caster.id)||actor.summoner===caster.id&&actor.summonConcentration&&!actor.dismissed)||battle.spellZones?.some(zone=>zone.caster===caster.id&&zone.concentration);
const markedEntries=(battle,caster,rule)=>battle.actors.flatMap(actor=>(actor.conditions??[]).filter(entry=>entry.spell===rule.reference&&entry.source===caster.id).map(entry=>({actor,entry})));

export function castCustomSpell(battle,caster,target,spell,slot,options={},random=Math.random){
 const baseRule=customSpellRule(spell.reference ?? spell.key,battle.spellRules);if(!baseRule)throw Error('This spell has no enabled rules in this room.');
 if(baseRule.level!==spell.level||baseRule.edition!==spell.edition)throw Error('The automation must match this spell’s source level and edition.');
 const rule=formRule(baseRule,options.form);
 const reaction=options.reaction,usage=spell.castUsage&&slot===0?spell.castUsage:undefined,effectiveSlot=usage?rule.level:slot,map=options.map;
 if(options.cover==='full'&&(rule.shape==='creature'||rule.attack))throw Error('Full cover blocks the spell.');
 if(rule.hearing&&[target,...(options.targets??[])].some(chosen=>chosen&&(chosen.conditions??[]).some(entry=>entry.name==='Deafened')))throw Error('That creature cannot hear you.');
 if(rule.shape==='creature'&&rule.effects.some(hostileBlock)&&charmedBy(caster,target))throw Error('This character is charmed by the target.');
 // Hex / Hunter's Mark style spells: once the marked creature is down, recasting moves the mark for a bonus action and no slot.
 const marks=rule.transfer&&caster.concentration?.name===rule.name?markedEntries(battle,caster,rule):[];
 const transferring=marks.length>0&&marks.every(({actor})=>actor.dead||actor.hp===0)&&target&&!marks.some(({actor})=>actor===target);
 if(transferring)checkCast(battle,caster,0,0,'bonus');else checkCast(battle,caster,rule.level,effectiveSlot,rule.timing,usage,options.slotPool);
 const spec=rule.targets,count=scaledTargets(rule,caster.level,effectiveSlot),given=[target,...(options.targets??[])].filter(Boolean);
 const individual=[target,...(options.targets??[])],entries=rule.shape==='creature'?(spec?.repeat?Array.from({length:count},(_,index)=>individual[index]??target).filter(Boolean):[...new Set(given)]):[];
 const chosenTargets=[...new Set(entries)];
 if(!spec?.repeat&&chosenTargets.length>count)throw Error('Too many spell targets for this slot.');
 const aimed=isAimed(rule),square=['self','aura'].includes(rule.shape)?{x:caster.x,y:caster.y}:options.square,sized=sizedRule(rule,effectiveSlot);
 if(aimed&&rule.shape!=='aura'){
  if(!square||!Number.isInteger(square.x)||!Number.isInteger(square.y)||square.x<0||square.y<0||square.x>=map?.cols||square.y>=map?.rows)throw Error('Choose a point on the map.');
  if(directional(rule)){if(!distanceFt(caster,square))throw Error('Choose the direction of the effect.');}
  else if(distanceFt(caster,square)>rule.range||!lineClear(battle,caster,square,map)||rule.sight&&!canSee(battle,caster,square,map))throw Error('Choose a point in range with a clear path.');
  if(rule.shape==='wall'&&(!options.end||!Number.isInteger(options.end.x)||!Number.isInteger(options.end.y)||options.end.x<0||options.end.y<0||options.end.x>=map.cols||options.end.y>=map.rows||distanceFt(square,options.end)>sized.length-5||!lineClear(battle,square,options.end,map)))throw Error('Choose a clear wall endpoint within its length.');
  if(rule.shape==='movable'&&!canStand(battle,{id:'spell-sphere'},square.x,square.y,map))throw Error('Place the sphere in an unoccupied square.');
 }else if(rule.shape==='creature'){
  if(!chosenTargets.length)throw Error('Choose a creature in range with a clear path.');
  for(const chosen of chosenTargets){
   if(!battle.actors.includes(chosen)||chosen.dead||chosen.x==null||distanceFt(caster,chosen)>rule.range||!lineClear(battle,caster,chosen,map)||rule.sight&&!canSee(battle,caster,chosen,map)&&!reaction)throw Error('Choose a creature in range with a clear path and required sight.');
   const problem=targetProblem(caster,chosen,spec);if(problem)throw Error(chosen.name+' '+problem+'.');
   if(rule.effects.some(hostileBlock)&&charmedBy(caster,chosen))throw Error('This character is charmed by a target.');
  }
 }
 const teleport=rule.effects.find(block=>block.kind==='teleport');
 if(teleport){
  if(!canStand(battle,caster,square.x,square.y,map))throw Error('Choose an unoccupied destination that fits the caster.');
  if(teleport.teleport.sight!==false&&!canSee(battle,caster,square,map))throw Error('You must be able to see the destination.');
 }
 if(rule.effects.some(block=>block.damage?.some(component=>component.addAbility)||block.summon?.attacks?.some(attack=>attack.addAbility))&&!Number.isFinite(caster.spellAbility))throw Error('Set the spellcasting ability modifier first.');
 if(rule.shape==='creature'&&chosenTargets.length&&rule.effects.every(block=>block.excludeTypes&&chosenTargets.some(chosen=>block.excludeTypes.includes(chosen.creatureType))))throw Error('This spell excludes that kind of creature.');
 if(rule.effects.some(block=>block.save||block.escape)&&!Number.isFinite(caster.spellDC))throw Error('Set this character’s spell save DC first.');
 if((rule.attack||rule.effects.some(block=>block.summon?.attacks?.some(attack=>attack.bonus==='spell')))&&!Number.isFinite(caster.spellAttack))throw Error('Set this character’s spell attack bonus first.');
 if(rule.weaponAttack){const weapon=options.weapon;if(!weapon||weapon.normalRange||!Number.isFinite(weapon.bonus))throw Error('Choose a melee weapon for '+rule.name+'.');}
 if(!transferring&&!reaction&&tryCounterspell(battle,caster,rule,effectiveSlot,map,random)){
  spendCast(battle,caster,rule.level,slot,rule.timing,usage,options.slotPool);
  log(battle,caster.name+' casts '+rule.name+' · the spell is countered.');
  return;
 }
 if(transferring)spendCast(battle,caster,0,0,'bonus');else spendCast(battle,caster,rule.level,slot,rule.timing,usage,options.slotPool);
 if(!rule.attack)breakInvisibility(battle,caster);
 const duration=scaledDuration(rule,effectiveSlot);
 if(rule.concentration&&!transferring)startConcentration(battle,caster,rule.name,duration);
 log(battle,caster.name+' casts '+rule.name+(transferring?' · moves the mark.':usage?' · '+(spell.grantedBy??'class feature')+'.':rule.level?' · level '+slot+' slot.':'.'));
 const ctx={battle,caster,rule:transferring?{...rule,duration:Math.max(6,(caster.concentration?.expires??0)-(battle.elapsed??0))}:rule,slot:effectiveSlot,dc:caster.spellDC,level:caster.level??1,ability:caster.spellAbility,random,map,reaction,options,saves:new Map()};
 const castBlocks=rule.effects.filter(block=>(block.trigger??'cast')==='cast'&&!['teleport','summon'].includes(block.kind??'damage'));
 const once=block=>['self','source'].includes(block.to??'targets');
 let anyHit=!rule.attack,volleyIndex=0;
 const runArea=()=>{
  for(const block of castBlocks){
   const cells=aimed?shapeCells(sized,caster,square,map,{...options,area:block.area}):null;
   // Cones, lines and auras start at the caster; the caster is not in their own area.
   const affected=aimed?battle.actors.filter(actor=>occupies(actor)&&touches(actor,cells)&&lineClear(battle,originatesAtCaster(rule)?caster:square,actor,map)&&!(originatesAtCaster(rule)&&actor.id===caster.id)):rule.shape==='self'?[caster]:[];
   applyBlock(ctx,affected,block,{entryKey:'area'+(volleyIndex)});
   // As with the native area spells, hostile creatures caught in a hostile area join an active combat.
   if(battle.round&&hostileBlock(block))for(const actor of affected)if(actor.side==='hostile'&&caster.side!=='hostile'&&!actor.dead)joinInitiative(battle,actor,random);
  }
 };
 if(rule.weaponAttack&&rule.shape==='creature'){
  const weapon=options.weapon;
  const foe=chosenTargets[0];if(!foe)throw Error('Choose a creature in reach.');
  const strike=weaponAttackForSpell(battle,caster,foe,weapon,options,random);
  anyHit=strike.hit;volleyIndex=0;
  if(strike.hit){
   for(const block of castBlocks.filter(block=>!once(block)))applyBlock(ctx,[foe],block,{critical:strike.critical,entryKey:'weapon'});
   applyAttackRiders(battle,caster,foe,{weapon,ranged:false,spell:false},strike.critical,random);
  }
  for(const block of castBlocks.filter(once))if(anyHit||block.always)applyBlock(ctx,[caster],block);
 }else if(rule.shape==='creature'&&(rule.attack||spec?.repeat)){
  // One independent roll per beam / dart / target: Scorching Ray, Eldritch Blast, Magic Missile.
  const groups=spec?.sharedRoll?[...new Set(entries)].map(creature=>({creature,count:entries.filter(entry=>entry===creature).length})):entries.map(creature=>({creature,count:1}));
  for(const [index,{creature,count:multiplier}] of groups.entries()){
   if(creature.dead)continue;
   let critical=false,hit=true;
   if(rule.attack){
    const distance=distanceFt(caster,creature),mode=attackMode(battle,caster,creature,options,rule.attack==='ranged',distance);
    const roll=d20(caster.spellAttack,{...mode,random,label:rule.name+' attack'});addInspiration(caster,roll,random);addSpellRollModifiers(caster,roll,'attack',random);
    if(creature.helped?.side===caster.side)delete creature.helped;
    const cover=Number(options.cover)||0;
    hit=roll.kept===20||roll.kept!==1&&roll.total>=armorClass(creature)+cover;
    if(hit&&roll.kept!==20&&creature.reactions?.length){
     fireReactions(battle,'hit',{reactor:creature,source:caster,attackTotal:roll.total,cover,map,spell:true},random);
     hit=roll.kept===20||roll.kept!==1&&roll.total>=armorClass(creature)+cover;
    }
    if(hit&&roll.kept!==20){
     const image=(creature.conditions??[]).find(entry=>(entry.mods?.images??entry.images)>0);
     if(image){const count=image.mods?.images??image.images,threshold=count>=3?6:count===2?8:11,check=d20(0,{random,label:'Mirror Image'});
      if(check.kept>=threshold){const next=count-1;if(image.mods)image.mods.images=next;else image.images=next;log(battle,'An image of '+creature.name+' is destroyed ('+check.total+').');if(next<=0)removeCondition(creature,image);hit=false;}
      else log(battle,creature.name+"'s mirror image is missed ("+check.total+' vs '+threshold+').');}
    }
    critical=hit&&(roll.kept===20||Boolean(mode.autoCrit));
    endStatuses(creature,'onAttacked');endStatuses(caster,'onAttack');caster.mocked=false;
    log(battle,'Spell attack on '+creature.name+' — '+roll.breakdown+' = '+roll.total+(critical?', critical hit.':hit?', hit.':', miss.'));
    recordAction(battle,caster,{outcome:critical?'Critical hit':hit?'Hit':'Miss',total:roll.total,roll:roll.breakdown,target:creature.name,targetActor:creature.id});
   }
   anyHit||=hit;volleyIndex=index;
   if(!hit)continue;
   for(const block of castBlocks.filter(block=>!once(block)))applyBlock(ctx,[creature],block,{critical,multiplier,entryKey:'entry'+index});
   if(rule.attack)applyAttackRiders(battle,caster,creature,{ranged:rule.attack==='ranged',spell:true},critical,random);
  }
  for(const block of castBlocks.filter(once))if(anyHit||block.always)applyBlock(ctx,[caster],block);
  if(rule.attack)breakInvisibility(battle,caster);
 }else if(rule.shape==='creature'){
  for(const block of castBlocks)applyBlock(ctx,chosenTargets,block,{entryKey:'cast'});
 }else if(rule.shape==='self'&&!aimed){
  for(const block of castBlocks)applyBlock(ctx,[caster],block,{entryKey:'cast'});
 }else runArea();
 // Cast-time one-off blocks: teleport, summon, dispel on a point.
 for(const block of rule.effects.filter(block=>(block.trigger??'cast')==='cast')){
  if(block.kind==='teleport'){
   caster.x=square.x;caster.y=square.y;log(battle,caster.name+' teleports to '+(square.x+1)+', '+(square.y+1)+'.');
   checkSpellTethers(battle,map);customZoneTriggers(battle,caster,'enter',undefined,random);refreshFollowZones(battle,caster,map);
  }else if(block.kind==='summon'){
   spawnSummons(battle,caster,rule,block.summon,square,effectiveSlot,{map,canStand});
  }
 }
 if(rule.concentration&&!transferring&&caster.concentration?.name===rule.name&&!rule.persistent&&!anchored(battle,caster))endConcentration(battle,caster);
 if(rule.persistent&&(!rule.concentration||caster.concentration?.name===rule.name)){
  const zoneRule=structuredClone(sized),cells=shapeCells(zoneRule,caster,square??caster,map,options),effectCells=zoneRule.effects.map(effect=>[...shapeCells(zoneRule,caster,square??caster,map,{...options,area:effect.area})]);
  const zone={id:crypto.randomUUID(),custom:true,caster:caster.id,name:rule.zoneName||rule.name,rule:zoneRule,slot:effectiveSlot,dc:caster.spellDC,level:caster.level??1,ability:caster.spellAbility,concentration:rule.concentration,blocksVision:rule.blocksVision,blocksRanged:rule.blocksRanged,blocksMovement:rule.blocksMovement,difficult:rule.difficult,cells:[...cells],effectCells,square:square??{x:caster.x,y:caster.y},end:options.end,hotSide:options.hotSide??'left',triggered:{},createdElapsed:battle.elapsed??0,expires:rule.endNextTurn?(battle.round?null:(battle.elapsed??0)+6):(battle.elapsed??0)+duration,endRound:rule.endNextTurn?battle.round+1:null};
  if(rule.shape==='aura')zone.follow=true;
  battle.spellZones=[...(battle.spellZones??[]),zone];
 }
}

// ───────────── zones ─────────────
export function expireCustomZones(battle){battle.spellZones=(battle.spellZones??[]).filter(zone=>{if(!zone.custom)return true;upgradeZone(zone);if(!battle.round&&zone.endRound!=null&&(battle.elapsed??0)>=(zone.createdElapsed??0)+6)return false;if(zone.expires!=null&&zone.expires<=(battle.elapsed??0))return false;if(zone.endRound!=null && (battle.round>zone.endRound || battle.actors.find(actor=>actor.id===zone.caster)?.dead && battle.round===zone.endRound && battle.turn>battle.order.indexOf(zone.caster)))return false;return true;});}
function zoneContext(battle,zone,caster,random){return {battle,caster,rule:zone.rule,slot:zone.slot,dc:zone.dc,level:zone.level??caster.level??1,ability:zone.ability??caster.spellAbility,random,saves:new Map()};}
function runZoneBlock(battle,zone,caster,actor,index,label,random,map){
 const block=zone.rule.effects[index];
 withActionEvent(battle,caster,{action:zone.name+' · '+label,kind:'spell',target:actor.name,targetActor:actor.id},()=>applyBlock({...zoneContext(battle,zone,caster,random),map},[actor],block,{entryKey:'zone'+index}));
}
export function customZoneTriggers(battle,actor,phase,from,random=Math.random){
 expireCustomZones(battle);if(!actor||actor.dead||actor.carriedBy)return;
 for(const zone of [...(battle.spellZones??[])]){
  if(!zone.custom)continue;const caster=battle.actors.find(actor=>actor.id===zone.caster);if(!caster)continue;
  for(const [i,block] of zone.rule.effects.entries()){
   const trigger=block.trigger??'cast',stepping=phase==='enter'&&trigger==='step';
   if(trigger!==phase&&!stepping)continue;
   if(!touches(actor,zone.effectCells[i]))continue;
   if(phase==='enter'&&!stepping&&from&&touches({...actor,...from},zone.effectCells[i]))continue;
   if(!stepping){
    const turn=battle.round?battle.round+':'+battle.order?.[battle.turn]:Math.floor((battle.elapsed??0)/6),stamp=actor.id+':'+phase+':'+i;
    if(zone.triggered[stamp]===turn)continue;zone.triggered[stamp]=turn;
   }
   runZoneBlock(battle,zone,caster,actor,i,({enter:'entered area',start:'start of turn',end:'end of turn',step:'moved through'}[phase]??phase),random);
  }
 }
 if(phase==='end')battle.spellZones=(battle.spellZones??[]).filter(zone=>!zone.custom||zone.endRound==null||zone.caster!==actor.id||battle.round<zone.endRound);
}
// Auras follow their caster.  Creatures newly inside trigger the aura's `enter` blocks.
export function refreshFollowZones(battle,mover,map,random=Math.random){
 if(!map)return;
 for(const zone of battle.spellZones??[]){
  if(!zone.custom||!zone.follow||zone.caster!==mover.id||!occupies(mover))continue;
  upgradeZone(zone);
  const before=zone.effectCells;
  zone.square={x:mover.x,y:mover.y};
  zone.cells=[...shapeCells(zone.rule,mover,mover,map)];
  zone.effectCells=zone.rule.effects.map(effect=>[...shapeCells(zone.rule,mover,mover,map,{area:effect.area})]);
  for(const creature of battle.actors){
   if(creature.id===mover.id||!occupies(creature)||creature.dead)continue;
   for(const [i,block] of zone.rule.effects.entries()){
    if(!['enter','step'].includes(block.trigger??'cast')||touches(creature,before[i]??[])||!touches(creature,zone.effectCells[i]))continue;
    const turn=battle.round?battle.round+':'+battle.order?.[battle.turn]:Math.floor((battle.elapsed??0)/6),stamp=creature.id+':enter:'+i;
    if(block.trigger==='enter'){if(zone.triggered[stamp]===turn)continue;zone.triggered[stamp]=turn;}
    runZoneBlock(battle,zone,mover,creature,i,'entered area',random,map);
   }
  }
 }
}
export function moveCustomSphere(battle,caster,zoneId,square,map,random=Math.random){
 battle=turnView(battle,caster);const zone=battle.spellZones?.find(zone=>zone.id===zoneId&&zone.caster===caster.id&&upgradeZone(zone)?.shape==='movable');
 if(!zone||!actorIsUp(caster)||incapacitated(caster)||battle.movement||battle.classReaction)throw Error('This sphere cannot be controlled now.');
 if(battle.round&&(!canTakeTurn(battle,caster)||battle.bonusUsed))throw Error('This character’s bonus action is unavailable.');
 if(!Number.isInteger(square?.x)||!Number.isInteger(square?.y)||square.x<0||square.y<0||square.x>=map.cols||square.y>=map.rows||distanceFt(zone.square,square)>zone.rule.move)throw Error('Choose a sphere destination within '+zone.rule.move+' feet.');
 const prior={x:zone.square.x,y:zone.square.y};
 const path=lineSquares(zone.square,square);for(let i=1;i<path.length;i++)if(!mapFloor(map,path[i].x,path[i].y,battle)||crossesMapWall(map,path[i-1],path[i],battle))throw Error('A wall blocks the sphere’s path.');
 const target=battle.actors.find(actor=>occupies(actor)&&actorCells(actor).some(cell=>cell.x===square.x&&cell.y===square.y));
 const destination=target?path.at(-2):square;if(!destination||!canStand(battle,{id:'spell-sphere'},destination.x,destination.y,map))throw Error('The sphere needs an open stopping square.');
 if(path.slice(1,-1).some(cell=>battle.actors.some(actor=>occupies(actor)&&actorCells(actor).some(c=>c.x===cell.x&&c.y===cell.y))))throw Error('A creature blocks the sphere’s path.');
 const diameter=Math.max(1,(zone.rule.radius>0?zone.rule.radius*2:5)/5);
 const travel=distanceFt(prior,destination);
 return withActionEvent(battle,caster,{action:zone.name+(target?' · Ram':' · Move'),kind:'spell',target:target?.name,targetActor:target?.id,
  ...spellVisualEvent(resolveSpellAnimation(zone.name,zone.rule,{distanceFt:travel}),caster,target,{square:target?square:destination,diameter,from:prior}),
  attackDistance:travel},()=>{
  if(battle.round)battle.bonusUsed=true;zone.square=destination;zone.cells=[...shapeCells(zone.rule,caster,destination,map)];zone.effectCells=zone.rule.effects.map(effect=>[...shapeCells(zone.rule,caster,destination,map,{area:effect.area})]);
  if(target)for(const block of zone.rule.effects.filter(block=>block.trigger==='ram'))applyBlock({...zoneContext(battle,zone,caster,random),map},[target],block);
  log(battle,caster.name+' moves '+zone.name+(target?' into '+target.name:'')+'.');if(!battle.round)advanceTime(battle,6);
 });
}

/** Wall of Light follow-up: action to fire a radiant beam at a creature within 60 ft of the wall. */
export function fireZoneBeam(battle,caster,zoneId,target,map,random=Math.random){
 battle=turnView(battle,caster);
 const zone=battle.spellZones?.find(entry=>entry.id===zoneId&&entry.caster===caster.id);
 if(!zone?.custom||!upgradeZone(zone))throw Error('That wall is gone.');
 const beams=zone.rule.effects.filter(block=>(block.trigger??'cast')==='beam');
 if(!beams.length)throw Error('This wall has no beam action.');
 if(!actorIsUp(caster)||incapacitated(caster)||battle.movement||battle.classReaction)throw Error('The beam action is unavailable.');
 if(battle.round&&(!canTakeTurn(battle,caster)||battle.action))throw Error('This character’s action is unavailable.');
 if(!target||!battle.actors.includes(target)||!occupies(target)||target.dead)throw Error('Choose a creature for the beam.');
 const nearWall=zone.cells?.some(cell=>{const [x,y]=String(cell).split(':').map(Number);return Number.isFinite(x)&&distanceFt({x,y},target)<=60;});
 if(!nearWall||!canSee(battle,caster,target,map))throw Error('Choose a creature you can see within 60 feet of the wall.');
 if(charmedBy(caster,target))throw Error('This character is charmed by the target.');
 const distance=distanceFt(caster,target);
 return withActionEvent(battle,caster,{action:zone.name+' · Beam',kind:'spell',target:target.name,targetActor:target.id,
  ...spellVisualEvent(resolveSpellAnimation(zone.name,zone.rule,{distanceFt:distance}),caster,target,{square:target})},()=>{
  if(battle.round)battle.action='spell';
  breakInvisibility(battle,caster);
  const mode=attackMode(battle,caster,target,{},true,distance);
  const roll=d20(caster.spellAttack,{...mode,random,label:zone.name+' beam'});
  addInspiration(caster,roll,random);addSpellRollModifiers(caster,roll,'attack',random);
  let hit=roll.kept===20||roll.kept!==1&&roll.total>=armorClass(target);
  if(hit&&roll.kept!==20&&target.reactions?.length){
   fireReactions(battle,'hit',{reactor:target,source:caster,attackTotal:roll.total,cover:0,map,spell:true},random);
   hit=roll.kept===20||roll.kept!==1&&roll.total>=armorClass(target);
  }
  const critical=hit&&(roll.kept===20||Boolean(mode.autoCrit));
  endStatuses(target,'onAttacked');endStatuses(caster,'onAttack');
  log(battle,caster.name+' launches a beam from '+zone.name+' at '+target.name+' — '+roll.breakdown+' = '+roll.total+(critical?', critical hit.':hit?', hit.':', miss.'));
  recordAction(battle,caster,{outcome:critical?'Critical hit':hit?'Hit':'Miss',total:roll.total,roll:roll.breakdown,target:target.name,targetActor:target.id});
  if(hit){
   for(const [index,block] of beams.entries())applyBlock({...zoneContext(battle,zone,caster,random),map},[target],block,{critical,entryKey:'beam'+index});
   applyAttackRiders(battle,caster,target,{ranged:true,spell:true},critical,random);
  }
  if(!battle.round)advanceTime(battle,6);
 });
}
export const spellSummons=summonedBy;

// Apply lingering / delayed damage when a status's `until` stamp is reached, then drop the status.
export function flushPendingDamage(battle,subject,when,random=Math.random){
 const round=battle.round||0;
 for(const actor of battle.actors){
  const ending=(actor.conditions??[]).filter(entry=>entry.pendingDamage&&entry.until&&entry.until.actor===subject.id&&entry.until.when===when&&round>=entry.until.round);
  if(!ending.length)continue;
  actor.conditions=actor.conditions.filter(entry=>!ending.includes(entry));
  for(const entry of ending){
   if(!actorIsUp(actor))continue;
   const roll=rollDice(entry.pendingDamage.formula,{random,label:(entry.name||'Lingering')+' damage'});
   const outcome=applyDamage(battle,actor,roll.total,entry.pendingDamage.type,false,random,battle.actors.find(a=>a.id===entry.source),{spell:true,magical:true});
   log(battle,actor.name+' takes '+outcome.damage+' '+entry.pendingDamage.type+' damage from '+entry.name+' ('+roll.breakdown+').');
  }
 }
}
