export const spellRuleVersion=1;
export const ruleKey=name=>String(name).toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export const ruleId=spell=>(spell.source??'PHB').toLowerCase()+'|'+ruleKey(spell.name);
export const damageTypes=['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'];
export const conditions=['','Charmed','Deafened','Invisible','Paralyzed','Prone','Stunned'];
export const triggers=['cast','enter','start','end','ram'];
export function formulaValid(value){
 if(typeof value!=='string'||value.length>60)return false;
 const expression=value.replace(/[−–]/g,'-').replace(/\s+/g,'');
 return /^[+-]?(?:\d*d(?:4|6|8|10|12|20)|\d+)(?:[+-](?:\d*d(?:4|6|8|10|12|20)|\d+))*$/i.test(expression)&&[...expression.matchAll(/(\d*)d(\d+)/gi)].every(match=>Number(match[1]||1)<=40);
}
const range=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
export function ruleProblems(rule){
 const problems=[];if(!rule || typeof rule!=='object')return ['Choose a spell.'];
 if(rule.version!==1)problems.push('Unsupported spell rule version.');
 if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>120)problems.push('Enter a spell name up to 120 characters.');
 if(typeof rule.reference!=='string'||rule.reference.length>180||!rule.reference.includes('|'))problems.push('Choose a source spell.');
 if(!['2014','2024'].includes(rule.edition))problems.push('Choose a rules edition.');
 if(!Number.isInteger(rule.level)||!range(rule.level,0,9))problems.push('Spell level must be 0–9.');
 if(!['action','bonus'].includes(rule.timing))problems.push('Choose an action or bonus-action casting time.');
 if(!['target','self','circle','cone','line','ring','sphere'].includes(rule.shape))problems.push('Choose a targeting shape.');
 for(const [key,max] of [['range',600],['radius',100],['length',120],['duration',86400],['nearby',30],['move',60]])if(!range(rule[key],0,max))problems.push(key+' is outside the supported range.');
 if(['circle','cone','line','ring'].includes(rule.shape)&&!(rule.shape==='line'?rule.length:rule.radius))problems.push('Area size must be greater than zero.');
 if(rule.persistent&&['target','self'].includes(rule.shape))problems.push('Persistent zones need an area targeting shape.');
 if(rule.shape==='sphere' && !rule.persistent)problems.push('A movable sphere needs a persistent area.');
 if(rule.concentration&&!rule.duration)problems.push('Concentration needs a positive duration.');
 if(rule.persistent && !rule.duration && !rule.endNextTurn)problems.push('Persistent effects need a duration.');
 for(const key of ['persistent','concentration','endNextTurn','difficult','blocksVision','attack','enabled'])if(typeof rule[key]!=='boolean')problems.push('Invalid '+key+' setting.');
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
  if(effect && !['damage','healing'].includes(effect.kind??'damage'))problems.push('Choose damage or healing for effect '+(i+1)+'.');
  if(effect?.excludeUndeadConstructs!=null&&typeof effect.excludeUndeadConstructs!=='boolean')problems.push('Use the creature-type exclusion checkbox.');
  if(effect?.kind==='healing'&&(effect.save||effect.condition||rule.attack))problems.push('Healing blocks cannot also use a save, condition or attack roll.');
  if(effect && !effect.damage?.length && !effect.condition)problems.push('Effect '+(i+1)+' needs damage or a condition.');
  if(effect?.trigger!=='cast'&&!rule.persistent)problems.push('Recurring triggers need a persistent area.');
  if(effect?.trigger==='ram'&&rule.shape!=='sphere')problems.push('Ramming needs a movable sphere.');
  if(effect?.area==='hotSide'&&!['line','ring'].includes(rule.shape))problems.push('A hot side needs a wall or ring.');
 }
 if(!rule.effects?.length&&!rule.difficult&&!rule.blocksVision)problems.push('Add an effect, difficult terrain or vision blocking.');
 if(rule.attack && (rule.shape!=='target'||Array.isArray(rule.effects)&&rule.effects.some(effect=>effect?.save)))problems.push('Spell attacks require a creature target and cannot also use a saving throw.');
 return [...new Set(problems)];
}
export function validRuleSet(rules){return rules && typeof rules==='object'&&!Array.isArray(rules)&&Object.keys(rules).length<=200&&Object.entries(rules).every(([id,rule])=>id===rule?.reference&&!ruleProblems(rule).length);}
export function blankRule(spell){return {version:1,name:spell.name,reference:ruleId(spell),source:spell.source,edition:spell.edition??'2014',level:spell.level??0,timing:spell.time?.[0]?.unit==='bonus'?'bonus':'action',shape:'target',range:spell.range?.distance?.amount??(spell.range?.distance?.type==='touch'?5:spell.range?.distance?.type==='self'?0:30),radius:20,length:60,duration:60,nearby:5,move:30,persistent:false,concentration:false,endNextTurn:false,difficult:false,blocksVision:false,attack:false,enabled:true,effects:[{trigger:'cast',area:'footprint',save:'dex',onSave:'half',condition:'',damage:[{formula:'1d6',type:'fire',upcast:'1d6'}]}]};}
export function starterRule(spell){
 const rule=blankRule(spell);if(rule.source!=='PHB'||!['wall of fire','ice storm','flaming sphere'].includes(ruleKey(spell.name)))return {...rule,effects:[]};
 const block=(trigger,formula,area='footprint',save='dex')=>({trigger,area,save,onSave:'half',condition:'',damage:[{formula,type:'fire',upcast:'1d8'}]});
 if(ruleKey(spell.name)==='wall of fire')Object.assign(rule,{shape:'line',range:120,length:60,radius:10,persistent:true,concentration:true,blocksVision:true,effects:[block('cast','5d8'),block('enter','5d8','footprint',''),block('end','5d8','hotSide','')]});
 if(ruleKey(spell.name)==='ice storm')Object.assign(rule,{shape:'circle',range:300,radius:20,persistent:true,difficult:true,concentration:false,endNextTurn:true,effects:[{trigger:'cast',area:'footprint',save:'dex',onSave:'half',condition:'',damage:[{formula:'2d8',type:'bludgeoning',upcast:'1d8'},{formula:'4d6',type:'cold',upcast:''}]}]});
 if(ruleKey(spell.name)==='flaming sphere')Object.assign(rule,{shape:'sphere',range:60,radius:0,persistent:true,concentration:true,nearby:5,move:30,effects:[{...block('end','2d6','nearby'),damage:[{formula:'2d6',type:'fire',upcast:'1d6'}]},{...block('ram','2d6'),damage:[{formula:'2d6',type:'fire',upcast:'1d6'}]}]});
 return rule;
}
