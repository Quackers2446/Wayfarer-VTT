// Data conversion only. Foundry macros and JavaScript are never evaluated.
import {blankRule,starterRule,ruleKey,damageTypes,formulaValid,nativeSpellLevels,ruleProblems} from './spell-rule-schema.mjs';

export function parseFoundrySpells(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>10*1024*1024)throw Error('Choose a spell export up to 10 MB.');
 let data;try{data=JSON.parse(text);}catch{try{data=text.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));}catch{throw Error('Choose a Foundry spell JSON export or a text .db compendium. Binary compendiums need exporting as JSON first.');}}
 const documents=Array.isArray(data)?data:Array.isArray(data?.items)?data.items:[data];
 if(documents.length>2000)throw Error('Import up to 2,000 records at a time.');
 const spells=documents.filter(item=>item&&typeof item==='object'&&item.type==='spell'&&typeof item.name==='string');
 if(!spells.length)throw Error('No Foundry spell items were found in this file.');
 return spells;
}

function diceFormula(value,notes){
 const text=String(value??'').replace(/@mod\b/g,'').replace(/\+\s*$/,'').trim();
 if(!formulaValid(text)){notes.push('A dice formula needs manual conversion: '+String(value??'').slice(0,100));return null;}
 return text;
}

export function convertFoundrySpell(item,catalog){
 const notes=['Imported as a disabled draft. Review the source text, test the rules, then enable and save.'];
 const matches=catalog.filter(spell=>ruleKey(spell.name)===ruleKey(item.name));
 const system=item.system??item.data?.data??item.data??{};
 const source=typeof system.source==='string'?system.source:system.source?.book??'';
 const edition=system.source?.rules==='2024'?'2024':'2014';
 const editionMatches=matches.filter(spell=>(spell.edition??'2014')===edition);
 const exact=editionMatches.filter(spell=>spell.source.toLowerCase()===String(source).toLowerCase());
 const spell=exact.length===1?exact[0]:editionMatches.length===1?editionMatches[0]:null;
 if(!spell)return {name:item.name,notes:['No unambiguous matching source spell. Choose a matching spell in the library and configure its rules manually.'],rule:null};
 const sourceCode=/^(?:player.?s handbook|basic rules|br\b|srd\b)/i.test(String(source))?'PHB':String(source).match(/^[A-Za-z0-9]+/)?.[0]?.toUpperCase();
 const verifiedSource=sourceCode===spell.source.toUpperCase()&&(system.level==null||Number(system.level)===spell.level);
 if(!verifiedSource)notes.push('Source or level differs from the standard spell. This record is not eligible for automatic runnable import.');
 if(!exact.length)notes.push('Source matched by name and edition; verify the source book.');
 const rule=blankRule(spell);rule.enabled=false;rule.effects=[];
 const activities=Object.values(system.activities??{}).filter(activity=>activity&&typeof activity==='object');
 if(activities.length>1)notes.push('Multiple Foundry activities: only the first activity is shown. Configure the others manually.');
 const activity=activities[0]??system;
 const activation=activity.activation??system.activation??{};
 if(['action','bonus'].includes(activation.type))rule.timing=activation.type;
 else notes.push('Casting time requires manual configuration; reactions and rituals are not supported by this editor.');
 if(activation.value>1||activation.cost>1)notes.push('Multiple-action casting needs manual implementation.');
 const range=system.range??{},target=activity.target??system.target??{},template=target.template??target;
 if(range.units==='touch')rule.range=5;
 else if(range.units==='self')rule.range=0;
 else if(range.units==='ft'&&Number.isFinite(Number(range.value)))rule.range=Number(range.value);
 else notes.push('Check range: unsupported or unspecified distance units.');
 const shape=template.type,amount=Number(template.size??template.value);
 if(['sphere','radius','cylinder'].includes(shape)){rule.shape='circle';rule.radius=amount;}
 else if(shape==='cone'){rule.shape='cone';rule.radius=amount;}
 else if(shape==='self')rule.shape='self';
 else if(['line','wall'].includes(shape)){rule.shape='line';rule.length=amount;notes.push('Check line placement, width and wall-specific behavior.');}
 else if(shape&&!['creature','enemy','ally',''].includes(shape))notes.push('Target shape needs manual configuration: '+shape);
 if((target.affects?.count??target.value)>1&&rule.shape==='target')notes.push('Multiple creature targets need manual implementation.');
 rule.duration=0;rule.concentration=false;
 const duration=system.duration??{},seconds={second:1,round:6,minute:60,hour:3600};
 if(seconds[duration.units])rule.duration=Number(duration.value)*seconds[duration.units];
 if(duration.units&&!['inst','instant'].includes(duration.units))notes.push('Duration and ongoing effects need review; recurring behavior is not inferred from spell descriptions.');
 const concentration=system.components?.concentration||system.concentration||system.properties?.includes?.('concentration');
 if(concentration){rule.concentration=true;if(!rule.duration)rule.duration=60;}
 const actionType=activity.type??system.actionType;
 rule.attack=['mwak','rwak','msak','rsak','attack'].includes(actionType);
 const saveValue=activity.save?.ability??system.save?.ability??'';
 const save=Array.isArray(saveValue)?saveValue[0]??'':saveValue;
 if(Array.isArray(saveValue)&&saveValue.length>1)notes.push('Alternative saving throws need manual implementation.');
 if(save&&!['str','dex','con','int','wis','cha'].includes(save))notes.push('Saving throw needs manual conversion.');
 const damage=activity.damage??system.damage??{};
 const parts=damage.parts??[];
 const block={trigger:'cast',area:'footprint',save:['str','dex','con','int','wis','cha'].includes(save)?save:'',onSave:damage.onSave==='none'?'none':'half',condition:'',damage:[]};
 if(block.save&&damage.onSave==null)notes.push('Verify what happens on a successful save; half damage is a draft default.');
 for(const part of parts){
  const raw=Array.isArray(part)?part[0]:part.custom?.enabled?part.custom.formula:`${part.number??1}d${part.denomination}${part.bonus?'+'+part.bonus:''}`;
  const type=Array.isArray(part)?part[1]:part.types?.[0];
  if(!damageTypes.includes(type)){notes.push('Unsupported damage/healing type needs review: '+String(type??''));continue;}
  const formula=diceFormula(raw,notes);if(!formula)continue;
  const upcast=system.scaling?.mode==='level'?system.scaling.formula:'';
  if(upcast&&!formulaValid(upcast))notes.push('Upcasting formula needs manual conversion.');
  block.damage.push({formula,type,upcast:formulaValid(upcast)?upcast:'',addAbility:/@mod\b/.test(String(raw))});
 }
 if(block.damage.length)rule.effects.push(block);
 if(Array.isArray(item.effects)&&item.effects.length)notes.push(item.effects.length+' Foundry Active Effect(s) need manual conversion. AC bonuses, buffs and expiration scripts are not executed.');
 const flags=item.flags??{};
 if(flags.itemacro||flags['midi-qol']||flags.dae)notes.push('This spell has module-specific automation or macros that are not executed.');
 const aa=flags.autoanimations;
 if(aa)notes.push('Automated Animations settings detected. Select an installed animation clip separately; Foundry scripts and asset database keys are not executed.');
 if(!rule.effects.length)notes.push('No supported damage blocks found. This draft needs effects before it can be saved.');
 notes.push('Review special mechanics such as repeated attacks, healing, terrain, immunity and movement against the source spell.');
 const nativeKey=ruleKey(spell.name);
 // These two complete Active Effect recipes can run through native roll hooks.
 // Other effects (e.g. Shield's reaction and Magic Missile immunity) are not
 // treated as complete just because an AC change happens to be present.
 if(verifiedSource&&edition==='2014'&&['bless','bane'].includes(nativeKey)){
  const changes=(item.effects??[]).flatMap(effect=>effect.changes??[]),sign=nativeKey==='bane'?'-1d4':'1d4';
  const attackKeys=['mwak','rwak','msak','rsak'].map(type=>'system.bonuses.'+type+'.attack'),saveKey='system.bonuses.abilities.save',allKey='system.bonuses.All-Attacks';
  const correct=changes.length&&changes.every(change=>change.mode===2&&[...attackKeys,saveKey,allKey].includes(change.key)&&change.value===sign)&&changes.some(change=>change.key===saveKey)&&(changes.some(change=>change.key===allKey)||attackKeys.every(key=>changes.some(change=>change.key===key)));
  if(correct){
   Object.assign(rule,{enabled:true,targets:{base:3,perSlot:1},sight:nativeKey==='bane',effects:[{kind:'modifier',trigger:'cast',area:'footprint',save:nativeKey==='bane'?'cha':'',onSave:'none',condition:'',damage:[],modifiers:{attack:sign,save:sign}}]});
   if(!ruleProblems(rule).length)return {name:item.name,spell,rule,status:'ready',notes:['Imported Active Effects are executable: '+sign+' to attacks and saves, multiple targets, higher-slot targeting, concentration and duration.']};
  }
 }
 if(verifiedSource&&edition==='2014'&&Object.hasOwn(nativeSpellLevels,nativeKey)&&nativeSpellLevels[nativeKey]===spell.level){
  const ready={...blankRule(spell),enabled:true,nativeKey,effects:[]};
  return {name:item.name,spell,rule:ready,status:'ready',notes:['Ready to play using Wayfarer’s existing implementation. The pack’s simpler fields will not replace its targeting, scaling or special behavior.',...((item.effects?.length||item.flags?.itemacro||item.flags?.['midi-qol'])?['Foundry Active Effects and macros in this record are ignored; this binding uses the standard Wayfarer spell behavior.']:[])]};
 }
 const starter=starterRule(spell);
 if(verifiedSource&&edition==='2014'&&starter.effects.length&&!ruleProblems(starter).length)return {name:item.name,spell,rule:starter,status:'ready',notes:['Ready to play using Wayfarer’s tested persistent-area implementation, including recurring triggers and concentration.']};
 return {name:item.name,spell,rule,notes,status:'partial'};
}

export function readyFoundryRules(entries,existing={}){
 const rules={};for(const entry of entries)if(entry.status==='ready'&&entry.rule&&!existing[entry.rule.reference])rules[entry.rule.reference]=entry.rule;
 return rules;
}
