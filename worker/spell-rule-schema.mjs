export const spellRuleVersion=2;
export const ruleKey=name=>String(name).toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export const ruleId=spell=>(spell.source??'PHB').toLowerCase()+'|'+ruleKey(spell.name);
export const damageTypes=['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'];
export const conditions=['','Charmed','Deafened','Invisible','Paralyzed','Prone','Stunned'];
export const triggers=['cast','enter','start','end','ram'];
// A native binding keeps an imported spell on its complete existing code path.
export const nativeSpellLevels={'vicious mockery':0,'sacred flame':0,'poison spray':0,'fire bolt':0,'ray of frost':0,'eldritch blast':0,'mind sliver':0,'healing word':1,'cure wounds':1,'false life':1,'armor of agathys':1,'misty step':2,'aid':2,'fireball':3,'burning hands':1,'dissonant whispers':1,'sleep':1,'hold person':2,'charm person':1,'invisibility':2,'witch bolt':1,'magic missile':1,'fog cloud':1,'darkness':2,'dragons breath':2};
export function formulaValid(value){
 if(typeof value!=='string'||value.length>60)return false;
 const expression=value.replace(/[−–]/g,'-').replace(/\s+/g,'');
 return /^[+-]?(?:\d*d(?:4|6|8|10|12|20)|\d+)(?:[+-](?:\d*d(?:4|6|8|10|12|20)|\d+))*$/i.test(expression)&&[...expression.matchAll(/(\d*)d(\d+)/gi)].every(match=>Number(match[1]||1)<=40);
}
const range=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
export function spellVisualValid(visual){
 if(!visual||typeof visual!=='object'||!['burst','ray','cone','line'].includes(visual.kind)||!range(visual.scale,.25,8)||!range(visual.duration,200,10000)||typeof visual.url!=='string'||visual.url.length>1000)return false;
 if(visual.anchor!=null&&!['caster','target'].includes(visual.anchor)||visual.length!=null&&!range(visual.length,.2,120)||visual.diameter!=null&&!range(visual.diameter,.2,100))return false;
 if(!visual.url)return true;
 if(!visual.url.startsWith('https://')&&!visual.url.startsWith('/assets/animations/'))return false;
 try{const url=new URL(visual.url,'https://wayfarer.invalid');return !url.username&&!url.password&&url.protocol==='https:'&&/\.(webm|mp4)$/i.test(url.pathname)&&(url.origin!=='https://wayfarer.invalid'||visual.url.startsWith('/assets/animations/'));}catch{return false;}
}
function legacyRuleProblems(rule){
 const problems=[];if(!rule || typeof rule!=='object')return ['Choose a spell.'];
 if(rule.version!==1)problems.push('Unsupported spell rule version.');
 if(rule.visual!=null&&!spellVisualValid(rule.visual))problems.push('Use a supported HTTPS video and playback style, scale 0.25–8 and duration 200–10000 ms.');
 if(rule.importNotes!=null&&(!Array.isArray(rule.importNotes)||rule.importNotes.length>30||rule.importNotes.some(note=>typeof note!=='string'||note.length>500)))problems.push('Invalid import review notes.');
 if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>120)problems.push('Enter a spell name up to 120 characters.');
 if(typeof rule.reference!=='string'||rule.reference.length>180||!rule.reference.includes('|'))problems.push('Choose a source spell.');
 if(!['2014','2024'].includes(rule.edition))problems.push('Choose a rules edition.');
 if(!Number.isInteger(rule.level)||!range(rule.level,0,9))problems.push('Spell level must be 0–9.');
 if(typeof rule.enabled!=='boolean')problems.push('Invalid enabled setting.');
 if(rule.nativeKey!=null){
  if(!Object.hasOwn(nativeSpellLevels,rule.nativeKey)||rule.nativeKey!==ruleKey(rule.name)||rule.level!==nativeSpellLevels[rule.nativeKey]||rule.edition!=='2014')problems.push('The native implementation must match the spell name, level and 2014 edition.');
 }
 if(!['action','bonus'].includes(rule.timing))problems.push('Choose an action or bonus-action casting time.');
 if(!['target','self','point','circle','cone','line','ring','sphere'].includes(rule.shape))problems.push('Choose a targeting shape.');
 if(rule.targets!=null&&(!Number.isInteger(rule.targets.base)||!range(rule.targets.base,1,8)||!Number.isInteger(rule.targets.perSlot)||!range(rule.targets.perSlot,0,3)||rule.shape!=='target'||rule.attack))problems.push('Multiple targets require a creature-target spell, 1–8 base targets and 0–3 additional targets per slot.');
 if(rule.sight!=null&&typeof rule.sight!=='boolean')problems.push('Invalid sight requirement.');
 if(rule.hearing!=null&&typeof rule.hearing!=='boolean')problems.push('Invalid hearing requirement.');
 for(const [key,max] of [['range',600],['radius',100],['length',120],['duration',86400],['nearby',30],['move',60]])if(!range(rule[key],0,max))problems.push(key+' is outside the supported range.');
 if(['circle','cone','line','ring'].includes(rule.shape)&&!(rule.shape==='line'?rule.length:rule.radius))problems.push('Area size must be greater than zero.');
 if(rule.persistent&&['target','self'].includes(rule.shape))problems.push('Persistent zones need an area targeting shape.');
 if(rule.shape==='sphere' && !rule.persistent)problems.push('A movable sphere needs a persistent area.');
 if(rule.concentration&&!rule.duration)problems.push('Concentration needs a positive duration.');
 if(rule.persistent && !rule.duration && !rule.endNextTurn)problems.push('Persistent effects need a duration.');
 for(const key of ['persistent','concentration','endNextTurn','difficult','blocksVision','attack','enabled'])if(typeof rule[key]!=='boolean')problems.push('Invalid '+key+' setting.');
 if(rule.nativeKey!=null){if(!Array.isArray(rule.effects)||rule.effects.length)problems.push('Native bindings use their existing effects.');return [...new Set(problems)];}
 if(!Array.isArray(rule.effects)||rule.effects.length>12)problems.push('Use up to 12 effect blocks.');
 else for(const [i,effect] of rule.effects.entries()){
  if(!effect || !triggers.includes(effect.trigger)||!['footprint','nearby','hotSide'].includes(effect.area)||!['','str','dex','con','int','wis','cha'].includes(effect.save)||!['half','none'].includes(effect.onSave)||!conditions.includes(effect.condition))problems.push('Effect '+(i+1)+' has an invalid trigger, area, save or condition.');
  if(!Array.isArray(effect?.damage)||effect.damage.length>4)problems.push('Use up to four damage components per block.');
  else for(const damage of effect.damage){
   if(!damage||typeof damage!=='object'||!formulaValid(damage.formula)||!damageTypes.includes(damage.type)||damage.upcast&&!formulaValid(damage.upcast))problems.push('Effect '+(i+1)+' needs valid dice and damage types.');
   if(damage?.addAbility!=null&&typeof damage.addAbility!=='boolean'||damage?.scaleWithCaster!=null&&typeof damage.scaleWithCaster!=='boolean')problems.push('Use checkboxes for ability modifiers and cantrip scaling.');
   if(damage?.scaleWithCaster&&rule.level!==0)problems.push('Caster-level scaling is for cantrips. Leveled spells use higher slots.');
   if(damage?.scaleWithCaster&&!damage.upcast)problems.push('Enter the extra dice for each cantrip tier.');
  }
  if(effect && !['damage','healing','modifier'].includes(effect.kind??'damage'))problems.push('Choose damage, healing or roll modifiers for effect '+(i+1)+'.');
  if(effect?.kind==='modifier'&&(!effect.modifiers||typeof effect.modifiers!=='object'||Object.keys(effect.modifiers).length===0||Object.keys(effect.modifiers).some(key=>!['attack','save'].includes(key))||Object.values(effect.modifiers).some(value=>!formulaValid(value))||effect.damage?.length||effect.condition||effect.trigger!=='cast'||!rule.duration||!['target','self'].includes(rule.shape)))problems.push('Roll modifiers need attack/save dice, a duration, creature targets and an on-cast trigger.');
  if(effect?.excludeUndeadConstructs!=null&&typeof effect.excludeUndeadConstructs!=='boolean')problems.push('Use the creature-type exclusion checkbox.');
  if(effect?.kind==='healing'&&(effect.save||effect.condition||rule.attack))problems.push('Healing blocks cannot also use a save, condition or attack roll.');
  if(effect && !effect.damage?.length && !effect.condition && effect.kind!=='modifier')problems.push('Effect '+(i+1)+' needs damage or a condition.');
  if(effect?.trigger!=='cast'&&!rule.persistent)problems.push('Recurring triggers need a persistent area.');
  if(effect?.trigger==='ram'&&rule.shape!=='sphere')problems.push('Ramming needs a movable sphere.');
  if(effect?.area==='hotSide'&&!['line','ring'].includes(rule.shape))problems.push('A hot side needs a wall or ring.');
 }
 if(!rule.effects?.length&&!rule.difficult&&!rule.blocksVision)problems.push('Add an effect, difficult terrain or vision blocking.');
 if(rule.attack && (rule.shape!=='target'||Array.isArray(rule.effects)&&rule.effects.some(effect=>effect?.save)))problems.push('Spell attacks require a creature target and cannot also use a saving throw.');
 return [...new Set(problems)];
}
// ───────────────────────── Rule schema v2 ─────────────────────────
// Everything below is data validation only (no code execution).  See SPELL_ENGINE.md for the full reference.
export const spellShapes=['creature','self','point','circle','cube','cone','line','wall','ring','aura','movable'];
export const reactionTriggers=['hit','damage','damaged','falling','spellCast','magicMissile'];
export const blockKinds=['damage','healing','effect','teleport','summon','dispel','sleep'];
export const blockTriggers=['cast','enter','start','end','ram','step','beam'];
export const blockTargets=['targets','self','source'];
export const blockAffects=['all','enemies','allies','others'];
export const abilityKeys=['str','dex','con','int','wis','cha'];
export const creatureTypeNames=['aberration','beast','celestial','construct','dragon','elemental','fey','fiend','giant','humanoid','monstrosity','ooze','plant','undead'];
export const conditionsV2=['','Asleep','Blinded','Charmed','Deafened','Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone','Restrained','Stunned','Unconscious','Hasted','Slowed'];
export const statusUntil=['','casterStart','casterEnd','targetStart','targetEnd'];
export const riderWhen=['weapon','melee','spell'];
export const sizeCodes=['T','S','M','L','H','G'];
const ruleObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const ruleKeysOnly=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
const ruleInt=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const ruleModes=['adv','dis'];
const ruleTopKeys=['version','name','reference','source','edition','level','school','enabled','timing','reactionTrigger','reactionDamageTypes','range','sight','hearing','shape','radius','side','length','width','origin','targets','attack','concentration','duration','scale','persistent','endNextTurn','difficult','blocksVision','blocksRanged','blocksMovement','nearby','move','transfer','zoneName','weaponAttack','effects','visual','importNotes','nativeKey','notes','revision','updatedAt'];
const ruleBlockKeys=['kind','trigger','area','affects','to','save','onSave','always','damage','condition','conditionDuration','repeatSave','endsOnDamage','escape','status','push','tempHp','tempHpUpcast','excludeTypes','teleport','summon','dispel','flee','retaliation','healFraction','tether','sleepPool','sleepPoolUpcast','pendingDamage','images','dominated'];
const ruleStatusKeys=['name','acBonus','acBase','speedBonus','speedMultiplier','attack','attackedBy','attackedNear','attackedFar','check','save','saveBonus','rollModifiers','resist','immune','vulnerable','resistAll','riders','markRiders','autoFail','noReactions','incapacitated','speedZero','maxHpBonus','maxHpBonusPerSlot','negateFall','extraAction','until','ends','duration','images','exhale','retaliation','blockMagicMissile'];

function ruleDamageProblems(rule,list,label){
 const problems=[];
 if(!Array.isArray(list)||list.length>4){problems.push(label+': use up to four damage components.');return problems;}
 for(const component of list){
  if(!ruleObject(component)||!ruleKeysOnly(component,['formula','type','upcast','upcastStep','scaleWithCaster','addAbility'])||!formulaValid(component.formula)||!damageTypes.includes(component.type)||component.upcast!=null&&component.upcast!==''&&!formulaValid(component.upcast)){problems.push(label+': every damage component needs valid dice and a damage type.');continue;}
  if(component.addAbility!=null&&typeof component.addAbility!=='boolean'||component.scaleWithCaster!=null&&typeof component.scaleWithCaster!=='boolean'||component.upcastStep!=null&&!ruleInt(component.upcastStep,1,4))problems.push(label+': invalid addAbility, scaleWithCaster or upcastStep.');
  if(component.scaleWithCaster&&rule.level!==0)problems.push(label+': caster-tier scaling is for cantrips. Leveled spells use higher slots.');
  if(component.scaleWithCaster&&!component.upcast)problems.push(label+': enter the extra dice for each cantrip tier.');
 }
 return problems;
}
function ruleRiderProblems(list,label){
 if(list==null)return [];
 if(!Array.isArray(list)||list.length>3)return [label+': use up to three damage riders.'];
 return list.every(rider=>ruleObject(rider)&&ruleKeysOnly(rider,['formula','type','upcast','upcastStep','when','consume'])&&formulaValid(rider.formula)&&(damageTypes.includes(rider.type)||['weapon','triggering'].includes(rider.type))&&(rider.upcast==null||rider.upcast===''||formulaValid(rider.upcast))&&(rider.upcastStep==null||ruleInt(rider.upcastStep,1,4))&&(rider.when==null||riderWhen.includes(rider.when))&&(rider.consume==null||typeof rider.consume==='boolean'))?[]:[label+': invalid damage rider.'];
}
function ruleStatusProblems(status,label){
 if(!ruleObject(status)||!ruleKeysOnly(status,ruleStatusKeys))return [label+': invalid status.'];
 const problems=[];
 if(status.name!=null&&(typeof status.name!=='string'||!status.name.trim()||status.name.length>40))problems.push(label+': status names are up to 40 characters.');
 if(status.acBonus!=null&&!ruleInt(status.acBonus,-10,10))problems.push(label+': AC bonus must be -10 to 10.');
 if(status.acBase!=null&&(!ruleObject(status.acBase)||!ruleKeysOnly(status.acBase,['base','dex'])||!ruleInt(status.acBase.base,5,30)||status.acBase.dex!=null&&typeof status.acBase.dex!=='boolean'))problems.push(label+': AC base needs a number 5–30 and optional dex flag.');
 if(status.speedBonus!=null&&!ruleInt(status.speedBonus,-60,60))problems.push(label+': speed bonus must be -60 to 60 ft.');
 if(status.speedMultiplier!=null&&!(Number.isFinite(status.speedMultiplier)&&status.speedMultiplier>=0&&status.speedMultiplier<=3))problems.push(label+': speed multiplier must be 0–3.');
 for(const key of ['attack','attackedBy','attackedNear','attackedFar','check'])if(status[key]!=null&&!ruleModes.includes(status[key]))problems.push(label+': '+key+' must be adv or dis.');
 if(status.save!=null&&(!ruleObject(status.save)||Object.entries(status.save).some(([key,mode])=>!([...abilityKeys,'all'].includes(key))||!ruleModes.includes(mode))))problems.push(label+': save modes use an ability (or all) with adv or dis.');
 if(status.saveBonus!=null&&(!ruleObject(status.saveBonus)||Object.entries(status.saveBonus).some(([key,value])=>!abilityKeys.includes(key)||!ruleInt(value,-10,10))))problems.push(label+': save bonuses use an ability and -10 to 10.');
 if(status.rollModifiers!=null&&(!ruleObject(status.rollModifiers)||!Object.keys(status.rollModifiers).length||Object.entries(status.rollModifiers).some(([key,value])=>!['attack','save','check','damage'].includes(key)||!formulaValid(value))))problems.push(label+': roll modifiers are attack/save/check/damage dice.');
 for(const key of ['resist','immune','vulnerable'])if(status[key]!=null&&(!Array.isArray(status[key])||status[key].length>13||status[key].some(type=>!damageTypes.includes(type)&&!(key==='resist'&&type==='triggering'))))problems.push(label+': '+key+' lists damage types.');
 for(const key of ['resistAll','noReactions','incapacitated','speedZero','negateFall','extraAction','blockMagicMissile'])if(status[key]!=null&&typeof status[key]!=='boolean')problems.push(label+': '+key+' is a checkbox.');
 if(status.autoFail!=null&&(!Array.isArray(status.autoFail)||status.autoFail.some(key=>!abilityKeys.includes(key))))problems.push(label+': autoFail lists abilities.');
 if(status.maxHpBonus!=null&&!ruleInt(status.maxHpBonus,0,200))problems.push(label+': max HP bonus must be 0–200.');
 if(status.maxHpBonusPerSlot!=null&&!ruleInt(status.maxHpBonusPerSlot,0,50))problems.push(label+': maxHpBonusPerSlot must be 0–50.');
 if(status.images!=null&&!ruleInt(status.images,1,8))problems.push(label+': images must be 1–8.');
 if(status.retaliation!=null&&typeof status.retaliation!=='boolean'&&!(ruleObject(status.retaliation)&&ruleKeysOnly(status.retaliation,['type'])&&damageTypes.includes(status.retaliation.type)))problems.push(label+': retaliation is a checkbox or {type}.');
 if(status.exhale!=null&&(!ruleObject(status.exhale)||!ruleKeysOnly(status.exhale,['faces','save','length'])||!ruleInt(status.exhale.faces,4,12)||!abilityKeys.includes(status.exhale.save)||!ruleInt(status.exhale.length,5,60)))problems.push(label+': exhale needs faces, save and length.');
 if(status.until!=null&&!statusUntil.includes(status.until))problems.push(label+': invalid until.');
 if(status.ends!=null&&(!ruleObject(status.ends)||!ruleKeysOnly(status.ends,['onAttacked','onAttack','onDamaged'])||Object.values(status.ends).some(value=>typeof value!=='boolean')))problems.push(label+': invalid ends.');
 if(status.duration!=null&&!ruleInt(status.duration,0,86400))problems.push(label+': status duration must be 0–86400 seconds.');
 problems.push(...ruleRiderProblems(status.riders,label+' riders'),...ruleRiderProblems(status.markRiders,label+' mark riders'));
 return problems;
}
function ruleSummonProblems(summon,label){
 if(!ruleObject(summon)||!ruleKeysOnly(summon,['name','count','hp','hpPerSlot','ac','speed','size','creatureType','attacks','swings']))return [label+': invalid summon.'];
 const problems=[];
 if(typeof summon.name!=='string'||!summon.name.trim()||summon.name.length>60)problems.push(label+': name the summoned creature.');
 if(summon.count!=null&&(!ruleObject(summon.count)||!ruleKeysOnly(summon.count,['base','perSlot'])||!ruleInt(summon.count.base,1,8)||!ruleInt(summon.count.perSlot??0,0,4)))problems.push(label+': summon count is 1–8 plus 0–4 per slot.');
 if(!ruleInt(summon.hp,1,1000)||summon.hpPerSlot!=null&&!ruleInt(summon.hpPerSlot,0,100)||!ruleInt(summon.ac,1,40)||!ruleInt(summon.speed,0,120))problems.push(label+': summon needs hp, ac and speed.');
 if(summon.size!=null&&!sizeCodes.includes(summon.size))problems.push(label+': size is T, S, M, L, H or G.');
 if(summon.creatureType!=null&&!creatureTypeNames.includes(summon.creatureType))problems.push(label+': unknown creature type.');
 if(summon.swings!=null&&!ruleInt(summon.swings,1,4))problems.push(label+': attacks per action is 1–4.');
 if(!Array.isArray(summon.attacks)||summon.attacks.length>3||summon.attacks.some(attack=>!ruleObject(attack)||!ruleKeysOnly(attack,['name','bonus','damage','type','addAbility','upcast','upcastStep','reach','normalRange','longRange'])||typeof attack.name!=='string'||!attack.name.trim()||attack.name.length>60||!(attack.bonus==='spell'||ruleInt(attack.bonus,-5,30))||!formulaValid(attack.damage)||!damageTypes.includes(attack.type)||attack.addAbility!=null&&typeof attack.addAbility!=='boolean'||attack.upcast!=null&&attack.upcast!==''&&!formulaValid(attack.upcast)||attack.upcastStep!=null&&!ruleInt(attack.upcastStep,1,4)||attack.reach!=null&&!ruleInt(attack.reach,5,30)||attack.normalRange!=null&&!ruleInt(attack.normalRange,5,300)||attack.longRange!=null&&!ruleInt(attack.longRange,5,600)))problems.push(label+': summon attacks need a name, bonus (or "spell"), damage and type.');
 return problems;
}
function ruleBlockProblems(rule,block,label){
 if(!ruleObject(block)||!ruleKeysOnly(block,ruleBlockKeys))return [label+' has unknown or invalid fields.'];
 const problems=[],kind=block.kind??'damage',trigger=block.trigger??'cast';
 if(!blockKinds.includes(kind))problems.push(label+': choose damage, healing, effect, teleport, summon, dispel or sleep.');
 if(!blockTriggers.includes(trigger))problems.push(label+': invalid trigger.');
 if(!['footprint','nearby','hotSide'].includes(block.area??'footprint'))problems.push(label+': invalid area.');
 if(block.affects!=null&&!blockAffects.includes(block.affects))problems.push(label+': invalid affects.');
 if(block.to!=null&&!blockTargets.includes(block.to))problems.push(label+': invalid recipient.');
 if(block.to==='source'&&rule.timing!=='reaction')problems.push(label+': only reactions have a source creature.');
 if(block.save!=null&&block.save!==''&&!abilityKeys.includes(block.save))problems.push(label+': invalid saving throw.');
 if(block.onSave!=null&&!['half','none'].includes(block.onSave))problems.push(label+': on a save choose half or none.');
 if(block.always!=null&&typeof block.always!=='boolean')problems.push(label+': always is a checkbox.');
 if(block.condition!=null&&!conditionsV2.includes(block.condition))problems.push(label+': unknown condition.');
 if(block.conditionDuration!=null&&!ruleInt(block.conditionDuration,0,86400))problems.push(label+': condition duration is 0–86400 seconds.');
 if(block.repeatSave!=null&&!['','start','end','damaged'].includes(block.repeatSave))problems.push(label+': repeat save is start, end or damaged.');
 if(block.repeatSave&&(!block.save||!block.condition))problems.push(label+': a repeat save needs an initial save and a condition.');
 if(block.endsOnDamage!=null&&typeof block.endsOnDamage!=='boolean')problems.push(label+': endsOnDamage is a checkbox.');
 if(block.dominated!=null&&typeof block.dominated!=='boolean')problems.push(label+': dominated is a checkbox.');
 if(block.dominated&&block.condition!=='Charmed')problems.push(label+': dominated marks a Charmed condition for Dominate spells.');
 if(block.escape!=null&&(!ruleObject(block.escape)||!ruleKeysOnly(block.escape,['ability'])||!abilityKeys.includes(block.escape.ability)||!block.condition))problems.push(label+': escape needs an ability and a condition.');
 if(block.status!=null)problems.push(...ruleStatusProblems(block.status,label));
 if(block.push!=null&&(!ruleObject(block.push)||!ruleKeysOnly(block.push,['mode','distance','maxSize'])||!['away','toward'].includes(block.push.mode)||!ruleInt(block.push.distance,5,60)||block.push.maxSize!=null&&!sizeCodes.includes(block.push.maxSize)))problems.push(label+': forced movement needs away/toward and 5–60 ft.');
 if(block.excludeTypes!=null&&(!Array.isArray(block.excludeTypes)||block.excludeTypes.length>14||block.excludeTypes.some(type=>!creatureTypeNames.includes(type))))problems.push(label+': excludeTypes lists creature types.');
 if(block.tempHp!=null&&block.tempHp!==''&&!formulaValid(block.tempHp)||block.tempHpUpcast!=null&&block.tempHpUpcast!==''&&!formulaValid(block.tempHpUpcast))problems.push(label+': invalid temporary hit point dice.');
 if(trigger!=='cast'&&!rule.persistent)problems.push(label+': recurring triggers need a persistent area.');
 if(trigger==='ram'&&rule.shape!=='movable')problems.push(label+': ramming needs a movable sphere.');
 if(trigger==='beam'&&rule.shape!=='wall')problems.push(label+': a beam follow-up needs a wall.');
 if(block.area==='hotSide'&&!['wall','ring'].includes(rule.shape))problems.push(label+': a hot side needs a wall or ring.');
 const has=name=>block[name]!=null&&block[name]!=='';
 if(block.flee!=null&&typeof block.flee!=='boolean')problems.push(label+': flee is a checkbox.');
 if(block.retaliation!=null&&typeof block.retaliation!=='boolean')problems.push(label+': retaliation is a checkbox.');
 if(block.healFraction!=null&&!(Number.isFinite(block.healFraction)&&block.healFraction>0&&block.healFraction<=1))problems.push(label+': healFraction is a fraction 0–1.');
 if(block.tether!=null&&typeof block.tether!=='boolean'&&!(ruleObject(block.tether)&&ruleKeysOnly(block.tether,['range','formula','type'])&&(block.tether.range==null||ruleInt(block.tether.range,5,120))&&(block.tether.formula==null||formulaValid(block.tether.formula))&&(block.tether.type==null||damageTypes.includes(block.tether.type))))problems.push(label+': tether is a checkbox or {range,formula,type}.');
 if(block.images!=null&&!ruleInt(block.images,1,8))problems.push(label+': images must be 1–8.');
 if(block.pendingDamage!=null&&(!ruleObject(block.pendingDamage)||!ruleKeysOnly(block.pendingDamage,['formula','type','upcast'])||!formulaValid(block.pendingDamage.formula)||!damageTypes.includes(block.pendingDamage.type)||(block.pendingDamage.upcast!=null&&block.pendingDamage.upcast!==''&&!formulaValid(block.pendingDamage.upcast))))problems.push(label+': pendingDamage needs formula and type.');
 if(block.sleepPoolUpcast!=null&&block.sleepPoolUpcast!==''&&!formulaValid(block.sleepPoolUpcast))problems.push(label+': invalid sleep pool upcast.');
 if(['damage','healing'].includes(kind)){
  problems.push(...ruleDamageProblems(rule,block.damage,label));
  if(!Array.isArray(block.damage)||!block.damage.length)problems.push(label+': add at least one damage or healing component.');
  if(kind==='healing'&&(block.save||block.condition||has('status')||has('push')||rule.attack))problems.push(label+': healing blocks cannot also use a save, condition, status, push or attack roll.');
 }else{
  if(block.damage!=null&&!(Array.isArray(block.damage)&&!block.damage.length))problems.push(label+': only damage and healing blocks have damage components.');
  if(kind==='effect'&&!(has('condition')||has('status')||has('push')||has('tempHp')||has('images')))problems.push(label+': an effect block needs a condition, status, push, temporary hit points or images.');
  if(kind==='sleep'&&!(has('sleepPool')&&formulaValid(block.sleepPool)))problems.push(label+': sleep needs a hit-point pool formula.');
  if(kind==='teleport'&&(!ruleObject(block.teleport)||!ruleKeysOnly(block.teleport,['who','sight'])||!['self'].includes(block.teleport.who)||block.teleport.sight!=null&&typeof block.teleport.sight!=='boolean'||block.teleport.who==='self'&&rule.shape!=='point'))problems.push(label+': teleporting needs a point-targeted spell with who set to self.');
  if(kind==='summon'){problems.push(...ruleSummonProblems(block.summon,label));if(rule.shape!=='point')problems.push(label+': summons are placed on a point.');}
  if(kind==='dispel'&&(!ruleObject(block.dispel)||!ruleKeysOnly(block.dispel,['level'])||!ruleInt(block.dispel.level,0,9)))problems.push(label+': dispel needs the highest spell level ended automatically.');
 }
 if(kind!=='teleport'&&block.teleport!=null)problems.push(label+': teleport details need a teleport block.');
 if(kind!=='summon'&&block.summon!=null)problems.push(label+': summon details need a summon block.');
 if(kind!=='dispel'&&block.dispel!=null)problems.push(label+': dispel details need a dispel block.');
 return problems;
}
function ruleV2Problems(rule){
 const problems=[];
 if(!ruleKeysOnly(rule,ruleTopKeys))problems.push('Unknown rule fields: '+Object.keys(rule).filter(key=>!ruleTopKeys.includes(key)).join(', ')+'.');
 if(rule.visual!=null&&!spellVisualValid(rule.visual))problems.push('Use a supported HTTPS video and playback style, scale 0.25–8 and duration 200–10000 ms.');
 if(rule.importNotes!=null&&(!Array.isArray(rule.importNotes)||rule.importNotes.length>30||rule.importNotes.some(note=>typeof note!=='string'||note.length>500)))problems.push('Invalid import review notes.');
 if(rule.notes!=null&&(typeof rule.notes!=='string'||rule.notes.length>1000))problems.push('Notes are up to 1000 characters.');
 if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>120)problems.push('Enter a spell name up to 120 characters.');
 if(typeof rule.reference!=='string'||rule.reference.length>180||!rule.reference.includes('|'))problems.push('Choose a source spell.');
 if(!['2014','2024'].includes(rule.edition))problems.push('Choose a rules edition.');
 if(!ruleInt(rule.level,0,9))problems.push('Spell level must be 0–9.');
 if(typeof rule.enabled!=='boolean')problems.push('Invalid enabled setting.');
 if(rule.school!=null&&(typeof rule.school!=='string'||rule.school.length>30))problems.push('Invalid school.');
 if(rule.nativeKey!=null){
  if(!Object.hasOwn(nativeSpellLevels,rule.nativeKey)||rule.nativeKey!==ruleKey(rule.name)||rule.level!==nativeSpellLevels[rule.nativeKey]||rule.edition!=='2014')problems.push('The native implementation must match the spell name, level and 2014 edition.');
  if(!Array.isArray(rule.effects)||rule.effects.length)problems.push('Native bindings use their existing effects.');
  return [...new Set(problems)];
 }
 if(!['action','bonus','reaction'].includes(rule.timing))problems.push('Choose an action, bonus-action or reaction casting time.');
 if(rule.timing==='reaction'){
  const triggers=Array.isArray(rule.reactionTrigger)?rule.reactionTrigger:[rule.reactionTrigger];
  if(!triggers.length||triggers.some(trigger=>!reactionTriggers.includes(trigger)))problems.push('A reaction needs a trigger: '+reactionTriggers.join(', ')+'.');
 }
 if(rule.timing!=='reaction'&&rule.reactionTrigger!=null)problems.push('Only reactions have a reaction trigger.');
 if(rule.reactionDamageTypes!=null&&(rule.timing!=='reaction'||!Array.isArray(rule.reactionDamageTypes)||!rule.reactionDamageTypes.length||rule.reactionDamageTypes.some(type=>!damageTypes.includes(type))))problems.push('reactionDamageTypes lists the damage types that can trigger a reaction.');
 if(!spellShapes.includes(rule.shape))problems.push('Choose a targeting shape: '+spellShapes.join(', ')+'.');
 if(!ruleInt(rule.range,0,600))problems.push('range must be a whole number of feet from 0 to 600.');
 if(rule.sight!=null&&typeof rule.sight!=='boolean')problems.push('Invalid sight requirement.');
 if(rule.hearing!=null&&typeof rule.hearing!=='boolean')problems.push('Invalid hearing requirement.');
 if(!['','ranged','melee'].includes(rule.attack??''))problems.push('attack must be empty, ranged or melee.');
 for(const [key,max,min] of [['radius',120,0],['side',120,5],['length',300,5],['width',30,5],['nearby',30,0],['move',60,0],['duration',86400,0]])if(rule[key]!=null&&!ruleInt(rule[key],min,max))problems.push(key+' is outside the supported range.');
 const need=(key,reason)=>{if(rule[key]==null||!(rule[key]>0)&&!(key==='radius'&&rule.shape==='movable'))problems.push(reason);};
 if(['circle','ring','aura'].includes(rule.shape))need('radius','Area size (radius) must be greater than zero.');
 if(rule.shape==='movable'&&rule.radius==null)problems.push('A movable sphere needs a radius (0 for a one-square sphere).');
 if(rule.shape==='cube')need('side','A cube needs a side length.');
 if(['cone','line','wall'].includes(rule.shape))need('length','A '+rule.shape+' needs a length.');
 if(rule.origin!=null&&(!['point','caster'].includes(rule.origin)||rule.shape!=='cube'))problems.push('origin applies to cubes only (point or caster).');
 if(rule.scale!=null&&(!ruleObject(rule.scale)||!ruleKeysOnly(rule.scale,['radius','side','length','duration'])||Object.values(rule.scale).some(value=>!ruleInt(value,0,86400))))problems.push('scale lists extra radius/side/length feet or duration seconds per slot.');
 if(rule.targets!=null){
  const spec=rule.targets;
  if(!ruleObject(spec)||!ruleKeysOnly(spec,['base','perSlot','perTier','repeat','sharedRoll','side','types','exclude','maxHp','self'])||!ruleInt(spec.base,1,12)||!ruleInt(spec.perSlot??0,0,4)||!ruleInt(spec.perTier??0,0,4)||spec.repeat!=null&&typeof spec.repeat!=='boolean'||spec.sharedRoll!=null&&typeof spec.sharedRoll!=='boolean'||spec.side!=null&&!['any','ally','enemy','other'].includes(spec.side)||spec.maxHp!=null&&!ruleInt(spec.maxHp,1,9999)||spec.self!=null&&typeof spec.self!=='boolean'||[spec.types,spec.exclude].some(list=>list!=null&&(!Array.isArray(list)||list.length>14||list.some(type=>!creatureTypeNames.includes(type)))))problems.push('targets needs a base 1–12, per-slot/per-tier growth 0–4 and valid filters.');
  if(!['creature'].includes(rule.shape))problems.push('Target counts and filters are for creature-targeted spells.');
  if(spec.sharedRoll&&!spec.repeat)problems.push('A shared roll is for volleys of darts (repeat targets).');
 }
 for(const key of ['persistent','concentration','endNextTurn','difficult','blocksVision','blocksRanged','blocksMovement','transfer','weaponAttack'])if(rule[key]!=null&&typeof rule[key]!=='boolean')problems.push('Invalid '+key+' setting.');
 if(rule.zoneName!=null&&(typeof rule.zoneName!=='string'||!rule.zoneName.trim()||rule.zoneName.length>40))problems.push('zoneName is up to 40 characters.');
 if(rule.weaponAttack&&rule.shape!=='creature')problems.push('Weapon-attack cantrips target a creature.');
 if(rule.concentration&&!rule.duration)problems.push('Concentration needs a positive duration.');
 if(rule.persistent&&['creature','self'].includes(rule.shape))problems.push('Persistent zones need an area targeting shape.');
 if(rule.shape==='movable'&&!rule.persistent)problems.push('A movable sphere needs a persistent area.');
 if(rule.shape==='aura'&&!rule.persistent)problems.push('An aura needs a persistent area.');
 if(rule.persistent&&!rule.duration&&!rule.endNextTurn)problems.push('Persistent effects need a duration.');
 if(rule.attack&&['point','circle','cube','cone','line','wall','ring','aura','movable','self'].includes(rule.shape))problems.push('Spell attacks require creature targeting.');
 if(rule.transfer&&!(rule.concentration&&rule.shape==='creature'))problems.push('Moving a mark needs a concentration spell that targets a creature.');
 if(!Array.isArray(rule.effects)||rule.effects.length>16)problems.push('Use up to 16 effect blocks.');
 else{
  for(const [i,block] of rule.effects.entries())problems.push(...ruleBlockProblems(rule,block,'Effect '+(i+1)));
  if(rule.attack&&rule.effects.some(block=>ruleObject(block)&&block.save&&(block.trigger??'cast')==='cast'&&!block.always))problems.push('Spell attacks cannot also use a saving throw unless the block is marked always.');
  if(!rule.effects.length&&!rule.difficult&&!rule.blocksVision&&!rule.blocksRanged&&!rule.blocksMovement)problems.push('Add an effect, difficult terrain or vision blocking.');
 }
 return [...new Set(problems.filter(Boolean))];
}
export function ruleProblems(rule){
 if(!rule||typeof rule!=='object'||Array.isArray(rule))return ['Choose a spell.'];
 if(rule.version===2)return ruleV2Problems(rule);
 return legacyRuleProblems(rule);
}

// Convert a stored v1 rule into the v2 vocabulary.  v2 rules are returned unchanged.  The result is what the engine runs.
export function migrateRule(rule){
 if(!rule||typeof rule!=='object'||rule.version===2)return rule;
 const shapes={target:'creature',self:'self',point:'point',circle:'circle',cone:'cone',line:'wall',ring:'ring',sphere:'movable'};
 const shape=shapes[rule.shape]??rule.shape,out={version:2,name:rule.name,reference:rule.reference,source:rule.source,edition:rule.edition,level:rule.level,enabled:rule.enabled,timing:rule.timing,range:rule.range,shape};
 for(const key of ['visual','importNotes','nativeKey','revision','updatedAt','sight'])if(rule[key]!=null)out[key]=rule[key];
 if(rule.nativeKey!=null){out.effects=[];return out;}
 if(shape==='cone')out.length=rule.radius;
 else{out.radius=rule.radius;if(['wall'].includes(shape))out.length=rule.length;}
 out.nearby=rule.nearby;out.move=rule.move;out.duration=rule.duration;
 for(const key of ['persistent','concentration','endNextTurn','difficult','blocksVision','blocksRanged','blocksMovement'])out[key]=Boolean(rule[key]);
 if(rule.attack)out.attack='ranged';
 if(rule.targets)out.targets={base:rule.targets.base,perSlot:rule.targets.perSlot};
 out.effects=(rule.effects??[]).map(block=>{
  const next={trigger:block.trigger,area:block.area,save:block.save,onSave:block.onSave,condition:block.condition,damage:block.damage};
  if(block.excludeUndeadConstructs)next.excludeTypes=['undead','construct'];
  if(block.kind==='healing')next.kind='healing';
  else if(block.kind==='modifier'){next.kind='effect';next.damage=[];next.status={rollModifiers:block.modifiers};}
  else next.kind='damage';
  return next;
 });
 return out;
}
export function validRuleSet(rules){return rules && typeof rules==='object'&&!Array.isArray(rules)&&Object.keys(rules).length<=200&&Object.entries(rules).every(([id,rule])=>id===rule?.reference&&!ruleProblems(rule).length);}
export function blankRule(spell){return {version:1,name:spell.name,reference:ruleId(spell),source:spell.source,edition:spell.edition??'2014',level:spell.level??0,timing:spell.time?.[0]?.unit==='bonus'?'bonus':'action',shape:'target',range:spell.range?.distance?.amount??(spell.range?.distance?.type==='touch'?5:spell.range?.distance?.type==='self'?0:30),radius:20,length:60,duration:60,nearby:5,move:30,persistent:false,concentration:false,endNextTurn:false,difficult:false,blocksVision:false,attack:false,enabled:true,effects:[{trigger:'cast',area:'footprint',save:'dex',onSave:'half',condition:'',damage:[{formula:'1d6',type:'fire',upcast:'1d6'}]}]};}
export function starterRule(spell){
 const rule=blankRule(spell);
 if(['PHB','XPHB'].includes(rule.source)&&ruleKey(spell.name)==='fireball'){
  return {...rule,shape:'circle',range:150,radius:20,effects:[{
   trigger:'cast',area:'footprint',save:'dex',onSave:'half',condition:'',
   damage:[{formula:'8d6',type:'fire',upcast:'1d6'}]
  }]};
 }
 if(rule.source!=='PHB'||!['wall of fire','ice storm','flaming sphere'].includes(ruleKey(spell.name)))return {...rule,effects:[]};
 const block=(trigger,formula,area='footprint',save='dex')=>({trigger,area,save,onSave:'half',condition:'',damage:[{formula,type:'fire',upcast:'1d8'}]});
 if(ruleKey(spell.name)==='wall of fire')Object.assign(rule,{shape:'line',range:120,length:60,radius:10,persistent:true,concentration:true,blocksVision:true,effects:[block('cast','5d8'),block('enter','5d8','footprint',''),block('end','5d8','hotSide','')]});
 if(ruleKey(spell.name)==='ice storm')Object.assign(rule,{shape:'circle',range:300,radius:20,persistent:true,difficult:true,concentration:false,endNextTurn:true,effects:[{trigger:'cast',area:'footprint',save:'dex',onSave:'half',condition:'',damage:[{formula:'2d8',type:'bludgeoning',upcast:'1d8'},{formula:'4d6',type:'cold',upcast:''}]}]});
 if(ruleKey(spell.name)==='flaming sphere')Object.assign(rule,{shape:'sphere',range:60,radius:0,duration:60,persistent:true,concentration:true,nearby:5,move:30,effects:[{...block('end','2d6','nearby'),damage:[{formula:'2d6',type:'fire',upcast:'1d6'}]},{...block('ram','2d6'),damage:[{formula:'2d6',type:'fire',upcast:'1d6'}]}]});
 return rule;
}
